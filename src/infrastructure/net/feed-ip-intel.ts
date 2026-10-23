import { type IpIntel, type IpOrigin, type IpRangeFeed, IpRangeIndex } from "../../domain/ip-intel.js";
import type { Logger } from "../../domain/logger.js";

export interface FeedIpIntelOptions {
  refreshMs?: number; // how long a loaded set of lists is good for
  deadlineMs?: number; // how long the first visitor waits for the lists
  maxBlocks?: number;
  logger?: Logger;
  now?: () => number;
}

/**
 * The published lists, kept in memory and reloaded at most once per window: the lists are
 * megabytes and barely move in a day, so every visitor after the first answers from memory for
 * free. The first one does not wait either: past `deadlineMs` the lookup gives up and the scan
 * comes back without this layer, while the load keeps going for the next visitor. A feed that
 * fails leaves the others standing.
 */
export class FeedIpIntel implements IpIntel {
  private readonly refreshMs: number;
  private readonly deadlineMs: number;
  private readonly maxBlocks: number;
  private readonly logger?: Logger;
  private readonly now: () => number;
  private loaded: { index: IpRangeIndex; at: number } | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly feeds: readonly IpRangeFeed[],
    {
      refreshMs = 12 * 3_600_000,
      deadlineMs = 1_500,
      maxBlocks = 60_000,
      logger,
      now = Date.now,
    }: FeedIpIntelOptions = {},
  ) {
    this.refreshMs = refreshMs;
    this.deadlineMs = deadlineMs;
    this.maxBlocks = maxBlocks;
    this.logger = logger;
    this.now = now;
  }

  async origin(ip: string): Promise<IpOrigin | null> {
    const stale = !this.loaded || this.now() - this.loaded.at >= this.refreshMs;
    const loading = stale ? this.load() : null;
    // With lists in hand the answer is immediate, even while a refresh runs behind it.
    if (!this.loaded && loading) {
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.deadlineMs);
      });
      try {
        await Promise.race([loading, deadline]);
      } finally {
        clearTimeout(timer);
      }
    }
    const match = this.loaded?.index.match(ip);
    if (!match || !this.loaded) return null;
    return {
      kind: match.kind,
      owner: match.owner,
      detail: match.detail,
      block: `${match.network}/${match.prefix}`,
      feed: match.feed,
      updatedAt: new Date(this.loaded.at).toISOString(),
    };
  }

  /** One load at a time, however many visitors arrive while it runs. */
  private load(): Promise<void> {
    this.loading ??= this.read()
      .catch((err: unknown) =>
        this.logger?.error("could not load the address lists", { error: (err as Error)?.message ?? "?" }),
      )
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private async read(): Promise<void> {
    const started = this.now();
    const index = new IpRangeIndex(this.maxBlocks);
    const results = await Promise.allSettled(this.feeds.map(async (feed) => [feed.id, await feed.ranges()] as const));
    const kept: Record<string, number> = {};
    for (const [i, result] of results.entries()) {
      if (result.status === "fulfilled") kept[result.value[0]] = index.add(result.value[0], result.value[1]);
      else
        this.logger?.error("could not read an address list", {
          feed: this.feeds[i].id,
          error: (result.reason as Error)?.message ?? "?",
        });
    }
    // Nothing loaded means no lists at all: keep whatever is in memory rather than wiping it.
    if (index.size === 0) return;
    this.loaded = { index, at: started };
    this.logger?.info("address lists loaded", { blocks: index.size, ms: this.now() - started, ...kept });
  }
}
