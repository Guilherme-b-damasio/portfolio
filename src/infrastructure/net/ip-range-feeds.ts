import { z } from "zod";
import type { IpRange, IpRangeFeed } from "../../domain/ip-intel.js";
import { hostPrefix, ipBytes, parseCidr } from "../../domain/ip.js";
import type { TextGet } from "./http-text.js";

export interface FeedOptions {
  url?: string;
  timeoutMs?: number;
}

/** Turns "network/prefix" into a block, dropping whatever does not parse. */
function blocks(cidrs: Iterable<string>, kind: IpRange["kind"], owner: string, detail: string | null): IpRange[] {
  const out: IpRange[] = [];
  for (const cidr of cidrs) {
    const parsed = parseCidr(cidr);
    if (parsed) out.push({ ...parsed, kind, owner, detail });
  }
  return out;
}

/**
 * The Tor project publishes the addresses its exit nodes leave from, one per line. A visitor on one
 * of them is not exposing anything: it is the one case where the IP says nothing about them.
 */
export class TorExitFeed implements IpRangeFeed {
  readonly id = "tor";
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly get: TextGet,
    { url = "https://check.torproject.org/torbulkexitlist", timeoutMs = 8_000 }: FeedOptions = {},
  ) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  async ranges(): Promise<IpRange[]> {
    const text = await this.get(this.url, AbortSignal.timeout(this.timeoutMs));
    const out: IpRange[] = [];
    for (const line of text.split("\n")) {
      const address = line.trim();
      // The list is bare addresses; one exit node is one block of a single address.
      if (!address || address.startsWith("#") || !ipBytes(address)) continue;
      out.push({ network: address, prefix: hostPrefix(address), kind: "tor", owner: "Tor", detail: "nó de saída" });
    }
    return out;
  }
}

// Only the fields the lookup needs; the rest of each published file is ignored.
const awsFile = z.object({
  prefixes: z.array(z.object({ ip_prefix: z.string(), region: z.string().nullish(), service: z.string().nullish() })),
  ipv6_prefixes: z
    .array(z.object({ ipv6_prefix: z.string(), region: z.string().nullish(), service: z.string().nullish() }))
    .optional(),
});

/**
 * AWS publishes every block it uses, each one under a service. The `AMAZON` service is the union of
 * all of them, so taking only those covers the cloud with a seventh of the entries.
 */
export class AwsRangesFeed implements IpRangeFeed {
  readonly id = "aws";
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly get: TextGet,
    { url = "https://ip-ranges.amazonaws.com/ip-ranges.json", timeoutMs = 8_000 }: FeedOptions = {},
  ) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  async ranges(): Promise<IpRange[]> {
    const file = awsFile.parse(JSON.parse(await this.get(this.url, AbortSignal.timeout(this.timeoutMs))));
    const out: IpRange[] = [];
    for (const entry of file.prefixes) {
      if (entry.service && entry.service !== "AMAZON") continue;
      out.push(...blocks([entry.ip_prefix], "datacenter", "AWS", entry.region ?? null));
    }
    for (const entry of file.ipv6_prefixes ?? []) {
      if (entry.service && entry.service !== "AMAZON") continue;
      out.push(...blocks([entry.ipv6_prefix], "datacenter", "AWS", entry.region ?? null));
    }
    return out;
  }
}

const gcpFile = z.object({
  prefixes: z.array(
    z.object({
      ipv4Prefix: z.string().optional(),
      ipv6Prefix: z.string().optional(),
      scope: z.string().nullish(),
      service: z.string().nullish(),
    }),
  ),
});

/** Google Cloud publishes one small file with every block it rents out, each under a region. */
export class GcpRangesFeed implements IpRangeFeed {
  readonly id = "gcp";
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly get: TextGet,
    { url = "https://www.gstatic.com/ipranges/cloud.json", timeoutMs = 8_000 }: FeedOptions = {},
  ) {
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  async ranges(): Promise<IpRange[]> {
    const file = gcpFile.parse(JSON.parse(await this.get(this.url, AbortSignal.timeout(this.timeoutMs))));
    return file.prefixes.flatMap((entry) =>
      blocks(
        [entry.ipv4Prefix, entry.ipv6Prefix].filter((p): p is string => !!p),
        "datacenter",
        "Google Cloud",
        entry.scope ?? null,
      ),
    );
  }
}

const azureFile = z.object({
  values: z.array(
    z.object({
      name: z.string(),
      properties: z.object({
        region: z.string().nullish(),
        addressPrefixes: z.array(z.string()).optional(),
      }),
    }),
  ),
});

/**
 * Azure's Service Tags file names every block by service and region. The `AzureCloud` tags are the
 * union per region, so the lookup only keeps those: a few thousand blocks instead of sixty thousand.
 * The published URL carries the week's date, so it comes from the environment and the feed is off
 * until it is set.
 */
export class AzureServiceTagsFeed implements IpRangeFeed {
  readonly id = "azure";
  private readonly timeoutMs: number;

  constructor(
    private readonly get: TextGet,
    private readonly url: string,
    { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
  ) {
    this.timeoutMs = timeoutMs;
  }

  async ranges(): Promise<IpRange[]> {
    const file = azureFile.parse(JSON.parse(await this.get(this.url, AbortSignal.timeout(this.timeoutMs))));
    return file.values
      .filter((tag) => /^AzureCloud(\.|$)/.test(tag.name))
      .flatMap((tag) =>
        blocks(tag.properties.addressPrefixes ?? [], "datacenter", "Azure", tag.properties.region || null),
      );
  }
}
