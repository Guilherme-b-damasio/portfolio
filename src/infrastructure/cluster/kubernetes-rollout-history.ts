import { z } from "zod";
import type { RolloutHistory, RolloutView } from "../../domain/delivery.js";
import { type KubeGet, readKube } from "./kubernetes-cluster-reader.js";

const owner = z.object({ kind: z.string(), name: z.string() });
const meta = z.object({
  name: z.string(),
  creationTimestamp: z.string().nullish(),
  annotations: z.record(z.string(), z.string()).nullish(),
  ownerReferences: z.array(owner).nullish(),
});
const replicaSets = z.object({
  items: z.array(
    z.object({
      metadata: meta,
      spec: z.object({
        replicas: z.number().default(0),
        template: z.object({
          spec: z.object({ containers: z.array(z.object({ name: z.string(), image: z.string() })) }),
        }),
      }),
      status: z.object({ readyReplicas: z.number().nullish() }).default({}),
    }),
  ),
});
const pods = z.object({
  items: z.array(
    z.object({
      metadata: meta,
      status: z
        .object({
          conditions: z
            .array(z.object({ type: z.string(), status: z.string(), lastTransitionTime: z.string().nullish() }))
            .default([]),
        })
        .default({ conditions: [] }),
    }),
  ),
});

const NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
const LABEL_SELECTOR = /^[A-Za-z0-9._/-]+=[A-Za-z0-9._-]+$/;
// The tag the image workflow pushes: `<YYYYMMDDHHmmss>-<short sha>`.
const TAG = /:(\d{14})-([0-9a-f]{7,40})$/;
const LIST_LIMIT = 50;

export interface KubernetesRolloutHistoryOptions {
  namespace: string;
  deployment: string; // its ReplicaSets are the revisions
  selector: string; // one `key=value` label that picks the deployment's ReplicaSets and pods
  container?: string; // whose image is the one deployed; the first container when unset
  timeoutMs?: number;
}

/**
 * Reads the deployment's revisions from its ReplicaSets (kept by `revisionHistoryLimit`), and when
 * each one's pod turned Ready. Two GETs in one namespace, matching the Role in k8s/rbac.yaml.
 */
export class KubernetesRolloutHistory implements RolloutHistory {
  private readonly query: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly get: KubeGet,
    private readonly options: KubernetesRolloutHistoryOptions,
  ) {
    const { namespace, deployment, selector, timeoutMs = 3_000 } = options;
    if (!NAME.test(namespace) || !NAME.test(deployment)) throw new Error("namespace ou deployment inválido");
    if (!LABEL_SELECTOR.test(selector)) throw new Error(`seletor inválido: ${selector.slice(0, 60)}`);
    this.query = new URLSearchParams({ labelSelector: selector, limit: String(LIST_LIMIT) }).toString();
    this.timeoutMs = timeoutMs;
  }

  async rollouts(): Promise<RolloutView[]> {
    const ns = this.options.namespace;
    const [sets, podList] = await Promise.all([
      readKube(this.get, `/apis/apps/v1/namespaces/${ns}/replicasets?${this.query}`, replicaSets, this.timeoutMs),
      readKube(this.get, `/api/v1/namespaces/${ns}/pods?${this.query}`, pods, this.timeoutMs),
    ]);

    // The newest Ready transition among each ReplicaSet's pods.
    const readyAt = new Map<string, string>();
    for (const pod of podList.items) {
      const set = pod.metadata.ownerReferences?.find((o) => o.kind === "ReplicaSet")?.name;
      const ready = pod.status.conditions.find((c) => c.type === "Ready" && c.status === "True")?.lastTransitionTime;
      if (set && ready && ready > (readyAt.get(set) ?? "")) readyAt.set(set, ready);
    }

    return sets.items
      .filter((rs) =>
        rs.metadata.ownerReferences?.some((o) => o.kind === "Deployment" && o.name === this.options.deployment),
      )
      .map((rs) => {
        const containers = rs.spec.template.spec.containers;
        const image = (containers.find((c) => c.name === this.options.container) ?? containers[0])?.image ?? "?";
        return {
          revision: Number(rs.metadata.annotations?.["deployment.kubernetes.io/revision"] ?? 0),
          image,
          sha: TAG.exec(image)?.[2] ?? null,
          startedAt: rs.metadata.creationTimestamp ?? null,
          readyAt: rs.spec.replicas > 0 ? (readyAt.get(rs.metadata.name) ?? null) : null,
          replicas: `${rs.status.readyReplicas ?? 0}/${rs.spec.replicas}`,
        };
      })
      .sort((a, b) => b.revision - a.revision)
      .map((rollout, i) => ({ ...rollout, current: i === 0 })); // the newest is what the deployment asks for
  }
}
