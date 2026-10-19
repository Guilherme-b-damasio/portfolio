import { describe, expect, it } from "vitest";
import { ClusterUnavailable } from "../src/domain/cluster.js";
import { KubeApiError, type KubeGet } from "../src/infrastructure/cluster/kubernetes-cluster-reader.js";
import { KubernetesRolloutHistory } from "../src/infrastructure/cluster/kubernetes-rollout-history.js";

// Trimmed ReplicaSets and pods in the shape the API server answers.
const owned = (kind: string, name: string) => [{ apiVersion: "apps/v1", kind, name, uid: "u", controller: true }];
const replicaSet = (name: string, revision: string, tag: string, replicas: number, ready: number, at: string) => ({
  metadata: {
    name,
    creationTimestamp: at,
    annotations: { "deployment.kubernetes.io/revision": revision },
    ownerReferences: owned("Deployment", "portfolio"),
  },
  spec: {
    replicas,
    template: {
      spec: {
        containers: [
          { name: "sidecar", image: "busybox:1.36" },
          { name: "web", image: `ghcr.io/guilherme-b-damasio/portfolio:${tag}` },
        ],
      },
    },
  },
  status: { replicas, readyReplicas: ready || undefined },
});
const replicaSets = {
  items: [
    replicaSet("portfolio-6b8c", "4", "20261017141907-a3b3c7a", 0, 0, "2026-10-17T14:21:00Z"),
    replicaSet("portfolio-7d9f", "5", "20261017171853-9eae1df", 1, 1, "2026-10-17T17:21:04Z"),
    replicaSet("portfolio-old", "3", "latest", 0, 0, "2026-10-16T00:00:00Z"),
    { ...replicaSet("other-1234", "9", "x", 1, 1, "2026-10-17T00:00:00Z"), metadata: { name: "other-1234" } },
  ],
};
const pods = {
  items: [
    {
      metadata: { name: "portfolio-7d9f-abcde", ownerReferences: owned("ReplicaSet", "portfolio-7d9f") },
      status: {
        conditions: [
          { type: "PodScheduled", status: "True", lastTransitionTime: "2026-10-17T17:21:04Z" },
          { type: "Ready", status: "True", lastTransitionTime: "2026-10-17T17:21:19Z" },
        ],
      },
    },
    { metadata: { name: "portfolio-7d9f-pending", ownerReferences: owned("ReplicaSet", "portfolio-7d9f") } },
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

const options = { namespace: "portfolio", deployment: "portfolio", selector: "app=portfolio", container: "web" };
const routes = {
  "/apis/apps/v1/namespaces/portfolio/replicasets": replicaSets,
  "/api/v1/namespaces/portfolio/pods": pods,
};

describe("KubernetesRolloutHistory", () => {
  it("lists the deployment's revisions, newest first, with the sha in each image tag", async () => {
    const { get, calls } = fakeApi(routes);
    const rollouts = await new KubernetesRolloutHistory(get, options).rollouts();
    expect(calls).toEqual([
      "/apis/apps/v1/namespaces/portfolio/replicasets?labelSelector=app%3Dportfolio&limit=50",
      "/api/v1/namespaces/portfolio/pods?labelSelector=app%3Dportfolio&limit=50",
    ]);
    expect(rollouts).toEqual([
      {
        revision: 5,
        image: "ghcr.io/guilherme-b-damasio/portfolio:20261017171853-9eae1df",
        sha: "9eae1df",
        startedAt: "2026-10-17T17:21:04Z",
        readyAt: "2026-10-17T17:21:19Z",
        replicas: "1/1",
        current: true,
      },
      {
        revision: 4,
        image: "ghcr.io/guilherme-b-damasio/portfolio:20261017141907-a3b3c7a",
        sha: "a3b3c7a",
        startedAt: "2026-10-17T14:21:00Z",
        readyAt: null,
        replicas: "0/0",
        current: false,
      },
      expect.objectContaining({ revision: 3, sha: null, current: false }),
    ]);
  });

  it("takes the first container's image when none is named", async () => {
    const { get } = fakeApi(routes);
    const [newest] = await new KubernetesRolloutHistory(get, { ...options, container: undefined }).rollouts();
    expect(newest.image).toBe("busybox:1.36");
    expect(newest.sha).toBeNull();
  });

  it("refuses names and selectors that could bend the API path", () => {
    const { get } = fakeApi({});
    expect(() => new KubernetesRolloutHistory(get, { ...options, namespace: "../nodes" })).toThrow();
    expect(() => new KubernetesRolloutHistory(get, { ...options, selector: "app in (a,b)" })).toThrow();
  });

  it("says RBAC is missing when the Role does not cover ReplicaSets", async () => {
    const { get } = fakeApi({
      ...routes,
      "/apis/apps/v1/namespaces/portfolio/replicasets": new KubeApiError(403, "x"),
    });
    await expect(new KubernetesRolloutHistory(get, options).rollouts()).rejects.toThrow(
      new ClusterUnavailable("o cluster recusou a leitura: falta permissão (RBAC)"),
    );
  });
});
