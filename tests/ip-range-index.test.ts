import { describe, expect, it } from "vitest";
import { IpRangeIndex, type IpRange } from "../src/domain/ip-intel.js";

const range = (network: string, prefix: number, owner: string, detail: string | null = null): IpRange => ({
  network,
  prefix,
  kind: owner === "Tor" ? "tor" : "datacenter",
  owner,
  detail,
});

describe("IpRangeIndex", () => {
  it("finds the block an address falls in", () => {
    const index = new IpRangeIndex();
    index.add("aws", [range("52.94.76.0", 22, "AWS"), range("18.228.0.0", 16, "AWS", "sa-east-1")]);
    expect(index.match("18.228.4.5")).toMatchObject({ owner: "AWS", detail: "sa-east-1", feed: "aws" });
    expect(index.match("200.150.1.2")).toBeNull();
  });

  it("answers with the most specific block, whatever order the feeds came in", () => {
    const index = new IpRangeIndex();
    index.add("aws", [range("18.0.0.0", 8, "AWS", "global")]);
    index.add("azure", [range("18.228.0.0", 16, "Azure", "brazilsouth")]);
    expect(index.match("18.228.4.5")).toMatchObject({ owner: "Azure", prefix: 16 });
    expect(index.match("18.1.1.1")).toMatchObject({ owner: "AWS", prefix: 8 });
  });

  it("keeps the families apart", () => {
    const index = new IpRangeIndex();
    index.add("gcp", [range("2600:1900::", 28, "Google Cloud")]);
    index.add("tor", [range("38.0.0.0", 8, "Tor")]);
    expect(index.match("2600:1900:4000::1")).toMatchObject({ owner: "Google Cloud" });
    expect(index.match("2800:1900:4000::1")).toBeNull();
    expect(index.match("38.97.116.17")).toMatchObject({ kind: "tor" });
  });

  it("matches a single exit node published as a /32", () => {
    const index = new IpRangeIndex();
    index.add("tor", [range("185.220.101.4", 32, "Tor", "nó de saída")]);
    expect(index.match("185.220.101.4")).toMatchObject({ owner: "Tor", detail: "nó de saída" });
    expect(index.match("185.220.101.5")).toBeNull();
  });

  it("skips malformed blocks and stops at the ceiling", () => {
    const index = new IpRangeIndex(2);
    expect(index.add("aws", [range("não é um ip", 24, "AWS"), range("10.0.0.0", 99, "AWS")])).toBe(0);
    expect(
      index.add("aws", [range("10.0.0.0", 8, "AWS"), range("11.0.0.0", 8, "AWS"), range("12.0.0.0", 8, "AWS")]),
    ).toBe(2);
    expect(index.size).toBe(2);
    expect(index.match("12.0.0.1")).toBeNull();
  });

  it("still matches a block too wide to file under one byte", () => {
    const index = new IpRangeIndex();
    index.add("feed", [range("0.0.0.0", 1, "Tudo")]);
    expect(index.match("120.0.0.1")).toMatchObject({ owner: "Tudo" });
  });
});
