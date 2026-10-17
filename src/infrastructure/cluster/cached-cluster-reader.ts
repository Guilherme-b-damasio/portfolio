import type { ClusterReader, NodeView, PodView } from "../../domain/cluster.js";

/**
 * Keeps each answer for a few seconds and shares a read in flight, so however many visitors open
 * the cluster panel, the API server sees at most one call per view per window. Failures are not kept.
 */
export class CachedClusterReader implements ClusterReader {
  private readonly entries = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(
    private readonly inner: ClusterReader,
    private readonly ttlMs = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  get namespaces(): readonly string[] {
    return this.inner.namespaces;
  }

  nodes(): Promise<NodeView[]> {
    return this.cached("nodes", () => this.inner.nodes());
  }

  pods(namespace: string): Promise<PodView[]> {
    // Outside the whitelist the inner reader refuses before any call; nothing is worth caching.
    if (!this.namespaces.includes(namespace)) return this.inner.pods(namespace);
    return this.cached(`pods/${namespace}`, () => this.inner.pods(namespace));
  }

  private cached<T>(key: string, read: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value as Promise<T>;
    const value = read();
    this.entries.set(key, { at: this.now(), value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }
}
