import { describe, expect, it } from "vitest";
import { NamespaceNotAllowed } from "../src/domain/cluster.js";
import { CachedClusterReader } from "../src/infrastructure/cluster/cached-cluster-reader.js";
import { FakeClusterReader, fakePod } from "./fakes/fake-cluster-reader.js";

function setup() {
  const inner = new FakeClusterReader();
  let now = 0;
  const reader = new CachedClusterReader(inner, 5_000, () => now);
  return { inner, reader, tick: (ms: number) => (now += ms) };
}

describe("CachedClusterReader", () => {
  it("answers a burst of visitors with one read per window", async () => {
    const { inner, reader, tick } = setup();
    const answers = await Promise.all(Array.from({ length: 20 }, () => reader.pods("portfolio")));
    expect(answers.every((a) => a[0] === fakePod)).toBe(true);
    await reader.nodes();
    expect(inner.calls).toBe(2);

    tick(4_999);
    await reader.pods("portfolio");
    expect(inner.calls).toBe(2);
    tick(1);
    await reader.pods("portfolio");
    expect(inner.calls).toBe(3);
  });

  it("does not keep a failure, so the next visitor tries again", async () => {
    const { inner, reader } = setup();
    inner.down = true;
    await expect(reader.nodes()).rejects.toThrow("fora de alcance");
    inner.down = false;
    await expect(reader.nodes()).resolves.toHaveLength(1);
    expect(inner.calls).toBe(2);
  });

  it("keeps the whitelist of the reader it wraps", async () => {
    const { inner, reader } = setup();
    expect(reader.namespaces).toEqual(["portfolio"]);
    await expect(reader.pods("kube-system")).rejects.toBeInstanceOf(NamespaceNotAllowed);
    expect(inner.calls).toBe(0);
  });
});
