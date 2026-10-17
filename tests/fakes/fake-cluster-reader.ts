import {
  type ClusterReader,
  ClusterUnavailable,
  NamespaceNotAllowed,
  type NodeView,
  type PodView,
} from "../../src/domain/cluster.js";

export const fakeNode: NodeView = {
  name: "vps-1",
  ready: true,
  kubeletVersion: "v1.33.4+k3s1",
  createdAt: "2026-09-01T00:00:00Z",
  cpuCapacityMilli: 2000,
  memoryCapacityBytes: 4 * 1024 ** 3,
  cpuUsageMilli: 410,
  memoryUsageBytes: 1.5 * 1024 ** 3,
};

export const fakePod: PodView = {
  namespace: "portfolio",
  name: "portfolio-7d9f-abcde",
  phase: "Running",
  ready: "1/1",
  restarts: 0,
  node: "vps-1",
  startedAt: "2026-10-16T00:21:30Z",
  cpuUsageMilli: 3,
  memoryUsageBytes: 64 * 1024 ** 2,
};

/** In-memory cluster for tests: counts reads, keeps the whitelist rule and can be switched off. */
export class FakeClusterReader implements ClusterReader {
  calls = 0;
  down = false;

  constructor(
    readonly namespaces: readonly string[] = ["portfolio"],
    private readonly nodeViews: NodeView[] = [fakeNode],
    private readonly podViews: PodView[] = [fakePod],
  ) {}

  async nodes(): Promise<NodeView[]> {
    this.calls++;
    if (this.down) throw new ClusterUnavailable("a API do cluster está fora de alcance");
    return this.nodeViews;
  }

  async pods(namespace: string): Promise<PodView[]> {
    if (!this.namespaces.includes(namespace)) throw new NamespaceNotAllowed(namespace, this.namespaces);
    this.calls++;
    if (this.down) throw new ClusterUnavailable("a API do cluster está fora de alcance");
    return this.podViews.filter((p) => p.namespace === namespace);
  }
}
