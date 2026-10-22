import { Resolver } from "node:dns/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthoritativeDnsServer } from "../src/infrastructure/dns/authoritative-dns-server.js";
import { InMemoryLeakProbes } from "../src/infrastructure/dns/in-memory-leak-probes.js";
import { LeakZone } from "../src/infrastructure/dns/leak-zone.js";
import { parseQuery, RCODE, TYPE } from "../src/infrastructure/dns/message.js";
import { dnsQuery } from "./fixtures/dns-query.js";

const ZONE = "leak.example.test";

function setup(options: Partial<ConstructorParameters<typeof LeakZone>[1]> = {}) {
  let clock = 1_000_000;
  let next = 0;
  const probes = new InMemoryLeakProbes(
    ZONE,
    { ttlMs: 60_000, maxProbes: 3, maxSightings: 2 },
    () => clock,
    () => (next++).toString(16).padStart(16, "a"),
  );
  const zone = new LeakZone(probes, { zone: ZONE, nameserver: `ns.${ZONE}`, ...options });
  const server = new AuthoritativeDnsServer(zone, { maxQueriesPerSecond: 5 }, () => clock);
  return { probes, server, tick: (ms: number) => (clock += ms) };
}

const rcode = (answer: Buffer | null) => answer!.readUInt16BE(2) & 0xf;
const counts = (answer: Buffer | null) => [6, 8].map((at) => answer!.readUInt16BE(at));

describe("leak probes", () => {
  it("records only issued tokens, one entry per resolver, and forgets them when they expire", () => {
    const { probes, tick } = setup();
    const probe = probes.issue()!;
    expect(probe.hostname).toBe(`${probe.token}.${ZONE}`);
    expect(probes.record("ffffffffffffffff", { address: "1.1.1.1", qtype: "A", clientSubnet: null })).toBe(false);

    const subnet = { family: 4 as const, address: "200.150.1.0", prefix: 24 };
    probes.record(probe.token.toUpperCase(), { address: "8.8.8.8", qtype: "A", clientSubnet: null });
    probes.record(probe.token, { address: "8.8.8.8", qtype: "AAAA", clientSubnet: subnet });
    probes.record(probe.token, { address: "8.8.8.8", qtype: "A", clientSubnet: null });
    probes.record(probe.token, { address: "8.8.4.4", qtype: "A", clientSubnet: null });
    probes.record(probe.token, { address: "9.9.9.9", qtype: "A", clientSubnet: null }); // past maxSightings
    expect(probes.sightings(probe.token)).toEqual([
      { address: "8.8.8.8", qtype: "A,AAAA", clientSubnet: subnet, at: new Date(1_000_000).toISOString() },
      { address: "8.8.4.4", qtype: "A", clientSubnet: null, at: new Date(1_000_000).toISOString() },
    ]);

    tick(60_000);
    expect(probes.sightings(probe.token)).toBeNull();
    expect(probes.record(probe.token, { address: "8.8.8.8", qtype: "A", clientSubnet: null })).toBe(false);
  });

  it("stops issuing when full, and issues again once the oldest expire", () => {
    const { probes, tick } = setup();
    expect([probes.issue(), probes.issue(), probes.issue()].every(Boolean)).toBe(true);
    expect(probes.issue()).toBeNull();
    tick(60_000);
    expect(probes.issue()).not.toBeNull();
    expect(probes.live).toBe(1);
  });
});

describe("leak zone", () => {
  it("answers a probe name, records the resolver and its client subnet", () => {
    const { probes, server } = setup({ answerV4: "203.0.113.9" });
    const { token } = probes.issue()!;
    const answer = server.respond(
      dnsQuery(`${token.toUpperCase()}.LEAK.example.test`, TYPE.A, {
        subnet: { family: 1, prefix: 24, bytes: [200, 150, 1] },
      }),
      "172.253.0.5",
    );
    expect(rcode(answer)).toBe(RCODE.NOERROR);
    expect(counts(answer)).toEqual([1, 0]);
    expect(answer!.includes(Buffer.from([203, 0, 113, 9]))).toBe(true);
    expect(probes.sightings(token)).toMatchObject([
      { address: "172.253.0.5", qtype: "A", clientSubnet: { address: "200.150.1.0", prefix: 24 } },
    ]);
  });

  it("answers NODATA with the SOA when there is no address to give, and NXDOMAIN for unknown names", () => {
    const { probes, server } = setup();
    const { token } = probes.issue()!;
    const nodata = server.respond(dnsQuery(`${token}.${ZONE}`, TYPE.AAAA), "1.1.1.1");
    expect([rcode(nodata), ...counts(nodata)]).toEqual([RCODE.NOERROR, 0, 1]);
    for (const name of ["ffffffffffffffff", `x.${token}`, "www"]) {
      const nx = server.respond(dnsQuery(`${name}.${ZONE}`, TYPE.A), "1.1.1.1");
      expect([rcode(nx), ...counts(nx)]).toEqual([RCODE.NXDOMAIN, 0, 1]);
    }
    expect(probes.sightings(token)).toHaveLength(1);
  });

  it("serves SOA and NS at the apex and the nameserver's own address", () => {
    const { server } = setup({ nameserverAddress: "203.0.113.53" });
    expect(counts(server.respond(dnsQuery(ZONE, TYPE.SOA), "1.1.1.1"))).toEqual([1, 0]);
    expect(counts(server.respond(dnsQuery(ZONE, TYPE.NS), "1.1.1.1"))).toEqual([1, 0]);
    const ns = server.respond(dnsQuery(`ns.${ZONE}`, TYPE.A), "1.1.1.1");
    expect(ns!.includes(Buffer.from([203, 0, 113, 53]))).toBe(true);
  });

  it("refuses names outside the zone without saying anything about them", () => {
    const { server } = setup();
    const refused = server.respond(dnsQuery("example.com", TYPE.A), "1.1.1.1");
    expect([rcode(refused), ...counts(refused)]).toEqual([RCODE.REFUSED, 0, 0]);
    // No amplification: the answer is the question echoed plus the OPT record.
    const query = dnsQuery("example.com", TYPE.ANY);
    expect(server.respond(query, "1.1.1.1")!.length).toBeLessThanOrEqual(query.length);
  });

  it("drops oversized datagrams and everything past the global ceiling in a second", () => {
    const { server, tick } = setup();
    expect(server.respond(Buffer.alloc(2_000), "1.1.1.1")).toBeNull();
    const query = dnsQuery(ZONE, TYPE.SOA);
    const replies = Array.from({ length: 6 }, () => server.respond(query, "1.1.1.1"));
    expect(replies.filter(Boolean)).toHaveLength(5); // dropped unread, the oversized one spent no slot
    tick(1_000);
    expect(server.respond(query, "1.1.1.1")).not.toBeNull();
    expect(server.stats).toEqual({ answered: 6, dropped: 2, malformed: 0 });
  });

  it("answers garbage with FORMERR", () => {
    const { server } = setup();
    const reply = server.respond(Buffer.from([1, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 9]), "1.1.1.1");
    expect(rcode(reply)).toBe(RCODE.FORMERR);
    expect(server.stats.malformed).toBe(1);
    expect(parseQuery(dnsQuery(ZONE, TYPE.A)).question.labels).toHaveLength(3);
  });
});

describe("over real UDP, asked by a real resolver library", () => {
  const { probes, server } = setup({ answerV4: "203.0.113.9" });
  const resolver = new Resolver({ timeout: 1_000, tries: 1 });

  beforeAll(async () => {
    const port = await server.listen(0, "127.0.0.1");
    resolver.setServers([`127.0.0.1:${port}`]);
  });
  afterAll(() => server.close());

  it("resolves a probe name through c-ares and sees the query arrive", async () => {
    const { token } = probes.issue()!;
    await expect(resolver.resolve4(`${token}.${ZONE}`)).resolves.toEqual(["203.0.113.9"]);
    await expect(resolver.resolveSoa(ZONE)).resolves.toMatchObject({ nsname: `ns.${ZONE}`, minttl: 60 });
    await expect(resolver.resolve4(`ffffffffffffffff.${ZONE}`)).rejects.toMatchObject({ code: "ENOTFOUND" });
    expect(probes.sightings(token)).toMatchObject([{ address: "127.0.0.1", qtype: "A" }]);
  });
});
