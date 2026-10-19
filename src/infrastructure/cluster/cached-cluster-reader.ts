import type { ClusterReader, NodeView, PodView } from "../../domain/cluster.js";
import { TtlCache } from "../cache/ttl-cache.js";

/**
 * Keeps each answer for a few seconds and shares a read in flight, so however many visitors open
 * the cluster panel, the API server sees at most one call per view per window. Failures are not kept.
 */
export class CachedClusterReader implements ClusterReader {
  private readonly cache: TtlCache;

  constructor(
    private readonly inner: ClusterReader,
    ttlMs = 5_000,
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache(ttlMs, now);
  }

  get namespaces(): readonly string[] {
    return this.inner.namespaces;
  }

  nodes(): Promise<NodeView[]> {
    return this.cache.get("nodes", () => this.inner.nodes());
  }

  pods(namespace: string): Promise<PodView[]> {
    // Outside the whitelist the inner reader refuses before any call; nothing is worth caching.
    if (!this.namespaces.includes(namespace)) return this.inner.pods(namespace);
    return this.cache.get(`pods/${namespace}`, () => this.inner.pods(namespace));
  }
}
