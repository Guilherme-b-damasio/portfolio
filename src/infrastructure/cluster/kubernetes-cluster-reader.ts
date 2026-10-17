import { z } from "zod";
import {
  type ClusterReader,
  ClusterUnavailable,
  NamespaceNotAllowed,
  type NodeView,
  type PodView,
} from "../../domain/cluster.js";
import { bytes, cpuMilli } from "./quantity.js";

/** One GET against the Kubernetes API, answering the parsed JSON body. Throws KubeApiError on a non-2xx. */
export type KubeGet = (path: string, signal: AbortSignal) => Promise<unknown>;

export class KubeApiError extends Error {
  override name = "KubeApiError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Only the fields the views need; everything else in the API objects is ignored.
const meta = z.object({ name: z.string(), namespace: z.string().optional(), creationTimestamp: z.string().nullish() });
const nodeList = z.object({
  items: z.array(
    z.object({
      metadata: meta,
      status: z.object({
        capacity: z.record(z.string(), z.string()).default({}),
        conditions: z.array(z.object({ type: z.string(), status: z.string() })).default([]),
        nodeInfo: z.object({ kubeletVersion: z.string() }).partial().default({}),
      }),
    }),
  ),
});
const podList = z.object({
  items: z.array(
    z.object({
      metadata: meta,
      spec: z.object({ nodeName: z.string().nullish() }).default({}),
      status: z
        .object({
          phase: z.string().default("Unknown"),
          startTime: z.string().nullish(),
          containerStatuses: z.array(z.object({ ready: z.boolean(), restartCount: z.number() })).default([]),
        })
        .default({ phase: "Unknown", containerStatuses: [] }),
    }),
  ),
});
const usage = z.object({ cpu: z.string(), memory: z.string() }).partial();
const nodeMetrics = z.object({ items: z.array(z.object({ metadata: meta, usage })) });
const podMetrics = z.object({
  items: z.array(z.object({ metadata: meta, containers: z.array(z.object({ usage })).default([]) })),
});

// What a namespace name can be (an RFC 1123 label), checked before it reaches a URL.
const NAMESPACE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const LIST_LIMIT = 200; // a small cluster never gets near it; a runaway namespace cannot flood the response

export interface KubernetesClusterReaderOptions {
  namespaces: readonly string[]; // the whitelist: pods() refuses every other namespace
  timeoutMs?: number; // per API call; metrics-server gets the same budget and is dropped past it
}

/**
 * Reads nodes and pods from the Kubernetes API, plus their usage from metrics-server when it is
 * installed. GET only, and only in the whitelisted namespaces, matching the Role in k8s/rbac.yaml.
 */
export class KubernetesClusterReader implements ClusterReader {
  readonly namespaces: readonly string[];
  private readonly timeoutMs: number;

  constructor(
    private readonly get: KubeGet,
    { namespaces, timeoutMs = 3_000 }: KubernetesClusterReaderOptions,
  ) {
    const invalid = namespaces.filter((ns) => !NAMESPACE.test(ns));
    if (invalid.length) throw new Error(`namespaces inválidos: ${invalid.join(", ")}`);
    this.namespaces = [...namespaces];
    this.timeoutMs = timeoutMs;
  }

  async nodes(): Promise<NodeView[]> {
    const [list, metrics] = await Promise.all([
      this.read("/api/v1/nodes", nodeList),
      this.readMetrics("/apis/metrics.k8s.io/v1beta1/nodes", nodeMetrics),
    ]);
    const used = new Map(metrics?.items.map((m) => [m.metadata.name, m.usage]));
    return list.items.map(({ metadata, status }) => {
      const u = used.get(metadata.name);
      return {
        name: metadata.name,
        ready: status.conditions.some((c) => c.type === "Ready" && c.status === "True"),
        kubeletVersion: status.nodeInfo.kubeletVersion ?? "?",
        createdAt: metadata.creationTimestamp ?? null,
        cpuCapacityMilli: cpuMilli(status.capacity.cpu ?? "") ?? 0,
        memoryCapacityBytes: bytes(status.capacity.memory ?? "") ?? 0,
        cpuUsageMilli: u?.cpu ? cpuMilli(u.cpu) : null,
        memoryUsageBytes: u?.memory ? bytes(u.memory) : null,
      };
    });
  }

  async pods(namespace: string): Promise<PodView[]> {
    if (!this.namespaces.includes(namespace)) throw new NamespaceNotAllowed(namespace, this.namespaces);
    const [list, metrics] = await Promise.all([
      this.read(`/api/v1/namespaces/${namespace}/pods?limit=${LIST_LIMIT}`, podList),
      this.readMetrics(`/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods`, podMetrics),
    ]);
    const used = new Map(metrics?.items.map((m) => [m.metadata.name, m.containers]));
    return list.items.map(({ metadata, spec, status }) => {
      const containers = used.get(metadata.name);
      const sum = (pick: (c: z.infer<typeof usage>) => number | null) =>
        containers ? containers.reduce((total, c) => total + (pick(c.usage) ?? 0), 0) : null;
      return {
        namespace,
        name: metadata.name,
        phase: status.phase,
        ready: `${status.containerStatuses.filter((c) => c.ready).length}/${status.containerStatuses.length}`,
        restarts: status.containerStatuses.reduce((total, c) => total + c.restartCount, 0),
        node: spec.nodeName ?? null,
        startedAt: status.startTime ?? null,
        cpuUsageMilli: sum((u) => (u.cpu ? cpuMilli(u.cpu) : null)),
        memoryUsageBytes: sum((u) => (u.memory ? bytes(u.memory) : null)),
      };
    });
  }

  private async read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    let body: unknown;
    try {
      body = await this.get(path, AbortSignal.timeout(this.timeoutMs));
    } catch (err) {
      if (err instanceof KubeApiError && err.status === 403)
        throw new ClusterUnavailable("o cluster recusou a leitura: falta permissão (RBAC)", { cause: err });
      if (err instanceof Error && err.name === "TimeoutError")
        throw new ClusterUnavailable(`a API do cluster não respondeu em ${this.timeoutMs} ms`, { cause: err });
      throw new ClusterUnavailable("a API do cluster está fora de alcance", { cause: err });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ClusterUnavailable("a API do cluster respondeu num formato que não reconheço");
    return parsed.data;
  }

  // metrics-server is optional: without it (or when it is slow) the views just carry no usage.
  private async readMetrics<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    try {
      return await this.read(path, schema);
    } catch {
      return null;
    }
  }
}
