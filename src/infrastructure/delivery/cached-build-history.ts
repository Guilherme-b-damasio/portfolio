import type { BuildHistory, BuildView } from "../../domain/delivery.js";
import { TtlCache } from "../cache/ttl-cache.js";

/**
 * Unauthenticated, GitHub allows 60 calls an hour per IP. Keeping the builds for a few minutes and
 * sharing a read in flight holds this server far below that, however many visitors run `deploys`.
 */
export class CachedBuildHistory implements BuildHistory {
  private readonly cache: TtlCache;

  constructor(
    private readonly inner: BuildHistory,
    ttlMs = 5 * 60_000,
    now: () => number = Date.now,
  ) {
    this.cache = new TtlCache(ttlMs, now);
  }

  builds(): Promise<BuildView[]> {
    return this.cache.get("builds", () => this.inner.builds());
  }
}
