import { afterEach, describe, expect, it, vi } from "vitest";
import { httpText } from "../src/infrastructure/net/http-text.js";
import {
  AwsRangesFeed,
  AzureServiceTagsFeed,
  GcpRangesFeed,
  TorExitFeed,
} from "../src/infrastructure/net/ip-range-feeds.js";

const serve = (body: string) => {
  const asked: string[] = [];
  return { asked, get: async (url: string) => (asked.push(url), body) };
};

describe("the published address feeds", () => {
  it("reads the Tor exit list as one block per address", async () => {
    const feed = new TorExitFeed(serve("# comentário\n185.220.101.4\n\n2a0b:f4c2::1\nnão é um ip\n").get);
    expect(await feed.ranges()).toEqual([
      { network: "185.220.101.4", prefix: 32, kind: "tor", owner: "Tor", detail: "nó de saída" },
      { network: "2a0b:f4c2::1", prefix: 128, kind: "tor", owner: "Tor", detail: "nó de saída" },
    ]);
  });

  it("keeps only the AMAZON union of the AWS file, with the region", async () => {
    const file = JSON.stringify({
      syncToken: "1",
      prefixes: [
        { ip_prefix: "18.228.0.0/16", region: "sa-east-1", service: "AMAZON" },
        { ip_prefix: "18.228.0.0/16", region: "sa-east-1", service: "EC2" },
        { ip_prefix: "nem cidr", region: "sa-east-1", service: "AMAZON" },
      ],
      ipv6_prefixes: [{ ipv6_prefix: "2600:1f00::/24", region: "us-east-1", service: "AMAZON" }],
    });
    expect(await new AwsRangesFeed(serve(file).get).ranges()).toEqual([
      { network: "18.228.0.0", prefix: 16, kind: "datacenter", owner: "AWS", detail: "sa-east-1" },
      { network: "2600:1f00::", prefix: 24, kind: "datacenter", owner: "AWS", detail: "us-east-1" },
    ]);
  });

  it("reads both families out of the Google Cloud file", async () => {
    const file = JSON.stringify({
      prefixes: [
        { ipv4Prefix: "34.95.0.0/16", scope: "southamerica-east1", service: "Google Cloud" },
        { ipv6Prefix: "2600:1900::/28", scope: "us-central1" },
      ],
    });
    expect(await new GcpRangesFeed(serve(file).get).ranges()).toEqual([
      { network: "34.95.0.0", prefix: 16, kind: "datacenter", owner: "Google Cloud", detail: "southamerica-east1" },
      { network: "2600:1900::", prefix: 28, kind: "datacenter", owner: "Google Cloud", detail: "us-central1" },
    ]);
  });

  it("keeps only Azure's AzureCloud tags, which are the union per region", async () => {
    const file = JSON.stringify({
      values: [
        { name: "AzureCloud.brazilsouth", properties: { region: "brazilsouth", addressPrefixes: ["20.201.0.0/16"] } },
        { name: "AzureCloud", properties: { region: "", addressPrefixes: ["13.64.0.0/11"] } },
        { name: "Storage.brazilsouth", properties: { region: "brazilsouth", addressPrefixes: ["20.150.0.0/16"] } },
      ],
    });
    const served = serve(file);
    const feed = new AzureServiceTagsFeed(served.get, "https://example.test/ServiceTags_Public.json");
    expect(await feed.ranges()).toEqual([
      { network: "20.201.0.0", prefix: 16, kind: "datacenter", owner: "Azure", detail: "brazilsouth" },
      { network: "13.64.0.0", prefix: 11, kind: "datacenter", owner: "Azure", detail: null },
    ]);
    expect(served.asked).toEqual(["https://example.test/ServiceTags_Public.json"]);
  });

  it("refuses a file the publisher does not recognise as its own format", async () => {
    await expect(new GcpRangesFeed(serve('{"outra":"coisa"}').get).ranges()).rejects.toThrow();
  });
});

describe("httpText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gives up on an answer that says it is too big", async () => {
    vi.stubGlobal("fetch", async () => new Response("x", { headers: { "content-length": "99999" } }));
    await expect(httpText(10)("https://example.test/list", AbortSignal.timeout(100))).rejects.toThrow(/acima de 10/);
  });

  it("gives up once the body itself goes past the ceiling", async () => {
    vi.stubGlobal("fetch", async () => new Response("0123456789abcdef"));
    await expect(httpText(8)("https://example.test/list", AbortSignal.timeout(100))).rejects.toThrow(/acima de 8/);
  });

  it("answers the body when it fits, and throws on a non-2xx", async () => {
    vi.stubGlobal("fetch", async () => new Response("1.2.3.4\n"));
    expect(await httpText(100)("https://example.test/list", AbortSignal.timeout(100))).toBe("1.2.3.4\n");
    vi.stubGlobal("fetch", async () => new Response("não", { status: 503 }));
    await expect(httpText(100)("https://example.test/list", AbortSignal.timeout(100))).rejects.toThrow(/503/);
  });
});
