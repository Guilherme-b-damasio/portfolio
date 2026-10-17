import { describe, expect, it } from "vitest";
import { ClusterUnavailable, NamespaceNotAllowed } from "../src/domain/cluster.js";
import {
  type KubeGet,
  KubeApiError,
  KubernetesClusterReader,
} from "../src/infrastructure/cluster/kubernetes-cluster-reader.js";

// Trimmed API objects in the shape the real API server and metrics-server answer.
const nodes = {
  items: [
    {
      metadata: { name: "vps-1", creationTimestamp: "2026-09-01T00:00:00Z" },
      status: {
        capacity: { cpu: "2", memory: "3999784Ki", pods: "110" },
        conditions: [
          { type: "MemoryPressure", status: "False" },
          { type: "Ready", status: "True" },
        ],
        nodeInfo: { kubeletVersion: "v1.33.4+k3s1", osImage: "Ubuntu" },
      },
    },
  ],
};
const nodeMetrics = { items: [{ metadata: { name: "vps-1" }, usage: { cpu: "412345678n", memory: "1572864Ki" } }] };
const pods = {
  items: [
    {
      metadata: { name: "portfolio-7d9f-abcde", namespace: "portfolio" },
      spec: { nodeName: "vps-1" },
      status: {
        phase: "Running",
        startTime: "2026-10-16T00:21:30Z",
        containerStatuses: [
          { ready: true, restartCount: 1 },
          { ready: false, restartCount: 2 },
        ],
      },
    },
    { metadata: { name: "portfolio-pending", namespace: "portfolio" }, spec: {}, status: { phase: "Pending" } },
  ],
};
const podMetrics = {
  items: [
    {
      metadata: { name: "portfolio-7d9f-abcde" },
      containers: [{ usage: { cpu: "3m", memory: "60Mi" } }, { usage: { cpu: "1m", memory: "4Mi" } }],
    },
  ],
};

function fakeApi(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const get: KubeGet = async (path) => {
    calls.push(path);
    const body = routes[path.split("?")[0]];
    if (body instanceof Error) throw body;
    if (body === undefined) throw new KubeApiError(404, "not found");
    return body;
  };
  return { get, calls };
}

const NS = ["portfolio", "flux-system"];

describe("KubernetesClusterReader", () => {
  it("joins nodes with their metrics-server usage", async () => {
    const { get } = fakeApi({ "/api/v1/nodes": nodes, "/apis/metrics.k8s.io/v1beta1/nodes": nodeMetrics });
    expect(await new KubernetesClusterReader(get, { namespaces: NS }).nodes()).toEqual([
      {
        name: "vps-1",
        ready: true,
        kubeletVersion: "v1.33.4+k3s1",
        createdAt: "2026-09-01T00:00:00Z",
        cpuCapacityMilli: 2000,
        memoryCapacityBytes: 3999784 * 1024,
        cpuUsageMilli: 412,
        memoryUsageBytes: 1572864 * 1024,
      },
    ]);
  });

  it("sums containers into one pod row, kubectl style", async () => {
    const { get, calls } = fakeApi({
      "/api/v1/namespaces/portfolio/pods": pods,
      "/apis/metrics.k8s.io/v1beta1/namespaces/portfolio/pods": podMetrics,
    });
    const rows = await new KubernetesClusterReader(get, { namespaces: NS }).pods("portfolio");
    expect(rows[0]).toEqual({
      namespace: "portfolio",
      name: "portfolio-7d9f-abcde",
      phase: "Running",
      ready: "1/2",
      restarts: 3,
      node: "vps-1",
      startedAt: "2026-10-16T00:21:30Z",
      cpuUsageMilli: 4,
      memoryUsageBytes: 64 * 1024 * 1024,
    });
    expect(rows[1]).toMatchObject({ phase: "Pending", ready: "0/0", restarts: 0, node: null, cpuUsageMilli: null });
    expect(calls).toContain("/api/v1/namespaces/portfolio/pods?limit=200");
  });

  it("still answers without metrics-server, just with no usage", async () => {
    const { get } = fakeApi({ "/api/v1/nodes": nodes, "/api/v1/namespaces/portfolio/pods": pods });
    const reader = new KubernetesClusterReader(get, { namespaces: NS });
    expect((await reader.nodes())[0]).toMatchObject({ cpuUsageMilli: null, memoryUsageBytes: null });
    expect((await reader.pods("portfolio"))[0]).toMatchObject({ cpuUsageMilli: null, memoryUsageBytes: null });
  });

  it("refuses namespaces outside the whitelist without calling the API", async () => {
    const { get, calls } = fakeApi({});
    const reader = new KubernetesClusterReader(get, { namespaces: NS });
    await expect(reader.pods("kube-system")).rejects.toBeInstanceOf(NamespaceNotAllowed);
    await expect(reader.pods("../nodes")).rejects.toThrow(/não é visível daqui; tente portfolio, flux-system/);
    expect(calls).toEqual([]);
  });

  it("rejects a whitelist that could not be a namespace", () => {
    expect(() => new KubernetesClusterReader(fakeApi({}).get, { namespaces: ["ok", "Bad/ns"] })).toThrow(/Bad\/ns/);
  });

  it("explains failures without naming the API server", async () => {
    const forbidden = fakeApi({ "/api/v1/nodes": new KubeApiError(403, "nodes is forbidden") });
    await expect(new KubernetesClusterReader(forbidden.get, { namespaces: NS }).nodes()).rejects.toThrow(
      new ClusterUnavailable("o cluster recusou a leitura: falta permissão (RBAC)"),
    );

    const down = fakeApi({ "/api/v1/nodes": new Error("connect ECONNREFUSED 10.43.0.1:443") });
    const err = await new KubernetesClusterReader(down.get, { namespaces: NS }).nodes().catch((e: Error) => e);
    expect(err).toBeInstanceOf(ClusterUnavailable);
    expect((err as Error).message).not.toContain("10.43");

    const garbled = fakeApi({ "/api/v1/nodes": { kind: "Status" } });
    await expect(new KubernetesClusterReader(garbled.get, { namespaces: NS }).nodes()).rejects.toThrow(/formato/);
  });

  it("gives up on a call past its timeout", async () => {
    const hang: KubeGet = (_path, signal) =>
      new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    const reader = new KubernetesClusterReader(hang, { namespaces: NS, timeoutMs: 20 });
    await expect(reader.nodes()).rejects.toThrow("a API do cluster não respondeu em 20 ms");
  });
});
