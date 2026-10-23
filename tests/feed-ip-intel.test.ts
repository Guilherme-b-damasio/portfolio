import { describe, expect, it, vi } from "vitest";
import type { IpRange, IpRangeFeed } from "../src/domain/ip-intel.js";
import { FeedIpIntel } from "../src/infrastructure/net/feed-ip-intel.js";

const aws: IpRange = {
  network: "18.228.0.0",
  prefix: 16,
  kind: "datacenter",
  owner: "AWS",
  detail: "sa-east-1",
};

/** A feed that counts how often it was read, so the cache can be checked. */
function fakeFeed(id: string, ranges: IpRange[]): IpRangeFeed & { reads: number } {
  return {
    id,
    reads: 0,
    async ranges() {
      this.reads += 1;
      return ranges;
    },
  };
}

const broken = (id: string): IpRangeFeed => ({ id, ranges: () => Promise.reject(new Error("502")) });
const logger = () => {
  const errors: string[] = [];
  return { errors, info: () => {}, error: (msg: string) => errors.push(msg) };
};

describe("FeedIpIntel", () => {
  it("answers from the lists and reads each feed once per window", async () => {
    const feed = fakeFeed("aws", [aws]);
    let clock = 0;
    const intel = new FeedIpIntel([feed], { refreshMs: 1_000, now: () => clock });

    expect(await intel.origin("18.228.4.5")).toEqual({
      kind: "datacenter",
      owner: "AWS",
      detail: "sa-east-1",
      block: "18.228.0.0/16",
      feed: "aws",
      updatedAt: new Date(0).toISOString(),
    });
    expect(await intel.origin("200.150.1.2")).toBeNull();
    expect(feed.reads).toBe(1);

    clock = 1_001;
    expect(await intel.origin("18.228.4.5")).toMatchObject({ owner: "AWS" });
    expect(feed.reads).toBe(2);
  });

  it("keeps the feeds that answered when one fails", async () => {
    const log = logger();
    const feed = fakeFeed("aws", [aws]);
    const intel = new FeedIpIntel([broken("tor"), feed], { logger: log });
    expect(await intel.origin("18.228.4.5")).toMatchObject({ owner: "AWS" });
    expect(log.errors).toEqual(["could not read an address list"]);
  });

  it("answers null and tries again when no feed could be read", async () => {
    const log = logger();
    const intel = new FeedIpIntel([broken("tor")], { logger: log });
    expect(await intel.origin("18.228.4.5")).toBeNull();
    expect(await intel.origin("18.228.4.5")).toBeNull();
    expect(log.errors).toHaveLength(2);
  });

  it("gives up at the deadline and has the lists for the next visitor", async () => {
    let release = () => {};
    const slow: IpRangeFeed = {
      id: "aws",
      ranges: () => new Promise((resolve) => (release = () => resolve([aws]))),
    };
    const intel = new FeedIpIntel([slow], { deadlineMs: 5 });

    expect(await intel.origin("18.228.4.5")).toBeNull();
    release();
    await vi.waitUntil(async () => (await intel.origin("18.228.4.5")) !== null, { timeout: 500 });
    expect(await intel.origin("18.228.4.5")).toMatchObject({ owner: "AWS" });
  });

  it("shares one load between the visitors that arrive together", async () => {
    const feed = fakeFeed("aws", [aws]);
    const intel = new FeedIpIntel([feed]);
    const answers = await Promise.all([intel.origin("18.228.4.5"), intel.origin("18.228.4.6")]);
    expect(answers.every((a) => a?.owner === "AWS")).toBe(true);
    expect(feed.reads).toBe(1);
  });
});
