import type { RolloutHistory, RolloutView } from "../../domain/delivery.js";
import { TtlCache } from "../cache/ttl-cache.js";

/** Same idea as CachedClusterReader: one read of the ReplicaSets per window, shared by every visitor. */
export class CachedRolloutHistory implements RolloutHistory {
  private readonly cache: TtlCache;

  constructor(
    private readonly inner: RolloutHistory,
    ttlMs = 10_000,
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache(ttlMs, now);
  }

  rollouts(): Promise<RolloutView[]> {
    return this.cache.get("rollouts", () => this.inner.rollouts());
  }
}
