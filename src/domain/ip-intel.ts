import { inPrefix, ipBytes, ipVersion } from "./ip.js";

/** What a feed says about an address: it is a datacenter's, or the way out of the Tor network. */
export type IpOriginKind = "tor" | "datacenter";

/** One block of addresses known to belong to someone: a cloud region, or one Tor exit as a /32. */
export interface IpRange {
  network: string;
  prefix: number;
  kind: IpOriginKind;
  owner: string; // "AWS", "Google Cloud", "Azure", "Tor"
  detail: string | null; // the region or service the feed published it under
}

/** A published list of blocks, loaded whole and matched in memory. */
export interface IpRangeFeed {
  readonly id: string; // "tor", "aws", "gcp", "azure"
  ranges(): Promise<IpRange[]>;
}

/** Where an address comes from, when some feed claims it. */
export interface IpOrigin {
  kind: IpOriginKind;
  owner: string;
  detail: string | null;
  block: string; // the block that matched, as "network/prefix"
  feed: string;
  updatedAt: string; // when the lists behind this answer were loaded
}

/**
 * Where an address comes from, from the published lists. Answers from memory: it sits on the
 * request path, so a lookup never waits on the network.
 */
export interface IpIntel {
  origin(ip: string): Promise<IpOrigin | null>;
}

/** One block with the feed it came from. */
export interface IndexedRange extends IpRange {
  feed: string;
}

/**
 * The blocks of every feed, kept for matching. Lookups are the hot path and the lists are tens of
 * thousands of blocks, so each one is filed under the first byte of its network: a lookup only
 * compares the handful that could possibly contain the address. The most specific block wins, the
 * way a routing table answers.
 */
export class IpRangeIndex {
  private readonly buckets = new Map<number, IndexedRange[]>();
  private readonly wide: IndexedRange[] = []; // prefixes under 8 bits, which no bucket can hold
  private count = 0;

  constructor(private readonly max = 60_000) {}

  get size(): number {
    return this.count;
  }

  /** Files the blocks of one feed, skipping anything malformed. Answers how many it kept. */
  add(feed: string, ranges: readonly IpRange[]): number {
    let kept = 0;
    for (const range of ranges) {
      if (this.count >= this.max) break;
      const bytes = ipBytes(range.network);
      if (!bytes || !Number.isInteger(range.prefix) || range.prefix < 0 || range.prefix > bytes.length * 8) continue;
      const entry: IndexedRange = { ...range, feed };
      if (range.prefix < 8) this.wide.push(entry);
      else {
        const key = bytes.length * 1000 + bytes[0]; // the family too: 10.0.0.0/8 is not a::/8
        const bucket = this.buckets.get(key);
        if (bucket) bucket.push(entry);
        else this.buckets.set(key, [entry]);
      }
      this.count += 1;
      kept += 1;
    }
    return kept;
  }

  /** The most specific block containing `ip`, or null when no feed claims it. */
  match(ip: string): IndexedRange | null {
    const bytes = ipBytes(ip);
    if (!bytes) return null;
    const candidates = [...(this.buckets.get(bytes.length * 1000 + bytes[0]) ?? []), ...this.wide];
    let best: IndexedRange | null = null;
    for (const range of candidates) {
      if (best && range.prefix <= best.prefix) continue;
      if (ipVersion(range.network) === ipVersion(ip) && inPrefix(ip, range.network, range.prefix)) best = range;
    }
    return best;
  }
}
