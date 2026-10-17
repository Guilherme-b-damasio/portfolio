import { describe, expect, it } from "vitest";
import { ClusterOff, InspectCluster } from "../src/application/inspect-cluster.js";
import { ClusterUnavailable, NamespaceNotAllowed } from "../src/domain/cluster.js";
import { fakeNode, fakePod, FakeClusterReader } from "./fakes/fake-cluster-reader.js";

const pod = (namespace: string, name: string) => ({ ...fakePod, namespace, name });

describe("InspectCluster", () => {
  it("lists nodes and the pods of every whitelisted namespace, sorted", async () => {
    const reader = new FakeClusterReader(
      ["portfolio", "docsage"],
      [fakeNode],
      [pod("portfolio", "web-b"), pod("docsage", "api"), pod("portfolio", "web-a"), pod("kube-system", "coredns")],
    );
    const overview = await new InspectCluster(reader).overview();
    expect(overview.namespaces).toEqual(["portfolio", "docsage"]);
    expect(overview.nodes).toEqual([fakeNode]);
    expect(overview.pods.map((p) => `${p.namespace}/${p.name}`)).toEqual([
      "docsage/api",
      "portfolio/web-a",
      "portfolio/web-b",
    ]);
  });

  it("defaults to the first whitelisted namespace and refuses the others", async () => {
    const reader = new FakeClusterReader(["portfolio", "docsage"], [fakeNode], [pod("docsage", "api"), fakePod]);
    const cluster = new InspectCluster(reader);
    expect((await cluster.pods()).map((p) => p.name)).toEqual([fakePod.name]);
    expect((await cluster.pods("docsage")).map((p) => p.name)).toEqual(["api"]);
    await expect(cluster.pods("kube-system")).rejects.toBeInstanceOf(NamespaceNotAllowed);
  });

  it("passes the reader's failure on", async () => {
    const reader = new FakeClusterReader();
    reader.down = true;
    await expect(new InspectCluster(reader).overview()).rejects.toBeInstanceOf(ClusterUnavailable);
  });

  it("is off without a reader", async () => {
    const cluster = new InspectCluster(null);
    expect(cluster.enabled).toBe(false);
    expect(cluster.namespaces).toEqual([]);
    await expect(cluster.overview()).rejects.toBeInstanceOf(ClusterOff);
    await expect(cluster.nodes()).rejects.toBeInstanceOf(ClusterOff);
  });
});
