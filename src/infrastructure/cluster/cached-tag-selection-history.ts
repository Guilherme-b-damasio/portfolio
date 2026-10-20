import type { TagSelectionHistory, TagSelectionView } from "../../domain/delivery.js";
import { TtlCache } from "../cache/ttl-cache.js";

/** Same idea as CachedRolloutHistory: one read of the Flux events per window, shared by every visitor. */
export class CachedTagSelectionHistory implements TagSelectionHistory {
  private readonly cache: TtlCache;

  constructor(
    private readonly inner: TagSelectionHistory,
    ttlMs = 10_000,
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache(ttlMs, now);
  }

  selections(): Promise<TagSelectionView[]> {
    return this.cache.get("selections", () => this.inner.selections());
  }
}
