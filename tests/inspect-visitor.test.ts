import { describe, expect, it } from "vitest";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import type { ExposureCheck, Observation, ReverseDns } from "../src/domain/exposure.js";
import type { IpIntel } from "../src/domain/ip-intel.js";
import { DnsReverseLookup } from "../src/infrastructure/net/dns-reverse-lookup.js";
import { UA } from "./fixtures/user-agents.js";

const observation = (ip: string): Observation => ({
  ip,
  headers: { "user-agent": UA.chromeWin, "accept-language": "pt-BR" },
  httpVersion: "1.1",
  viaProxy: true,
  tls: null,
  headerOrder: null,
});

const fixed = (id: string, verdict: "ok" | "info" | "exposto" | "contradicao"): ExposureCheck => ({
  id,
  run: () => [{ id, layer: "http", verdict, title: id, detail: "", evidence: [] }],
});

const dns = (name: string | null): ReverseDns & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, lookup: async (ip) => (asked.push(ip), name) };
};

describe("InspectVisitor", () => {
  it("runs every check and puts contradictions and exposures first", async () => {
    const checks = [fixed("a", "ok"), fixed("b", "exposto"), fixed("c", "contradicao"), fixed("d", "info")];
    const report = await new InspectVisitor(checks, dns(null)).execute(observation("200.150.1.2"), null);
    expect(report.findings.map((f) => f.id)).toEqual(["c", "b", "d", "a"]);
    expect(report.summary).toEqual({ exposures: 1, contradictions: 1, checks: 4, probe: false });
    expect(report.claimed).toMatchObject({ browser: "chrome", os: "windows" });
  });

  it("keeps going when one check throws", async () => {
    const broken: ExposureCheck = {
      id: "broken",
      run: () => {
        throw new Error("bug");
      },
    };
    const report = await new InspectVisitor([broken, fixed("a", "ok")], dns(null)).execute(
      observation("1.1.1.1"),
      null,
    );
    expect(report.findings.map((f) => f.id)).toEqual(["a"]);
  });

  it("looks up public IPs only, without the IPv4-mapped prefix", async () => {
    const resolver = dns("host.provedor.net");
    const pub = await new InspectVisitor([], resolver).execute(observation("::ffff:200.150.1.2"), null);
    expect(resolver.asked).toEqual(["200.150.1.2"]);
    expect(pub.signals).toContainEqual({ layer: "rede", label: "DNS reverso", value: "host.provedor.net" });

    await new InspectVisitor([], resolver).execute(observation("10.42.0.7"), null);
    expect(resolver.asked).toHaveLength(1);
  });

  it("shows who owns the IP's block, and asks the lists about public addresses only", async () => {
    const asked: string[] = [];
    const intel: IpIntel = {
      lookup: async (ip) => {
        asked.push(ip);
        return {
          origin: { kind: "datacenter", owner: "AWS", detail: "sa-east-1", block: "18.228.0.0/16", feed: "aws" },
          updatedAt: "2026-10-13T15:00:00.000Z",
        };
      },
    };
    const report = await new InspectVisitor([], dns(null), intel).execute(observation("::ffff:18.228.4.5"), null);
    expect(asked).toEqual(["18.228.4.5"]);
    expect(report.signals).toContainEqual({
      layer: "rede",
      label: "dono do bloco",
      value: "AWS (sa-east-1) · 18.228.0.0/16",
    });

    await new InspectVisitor([], dns(null), intel).execute(observation("10.42.0.7"), null);
    expect(asked).toHaveLength(1);
  });

  it("leaves the block out when no list could be read", async () => {
    const intel: IpIntel = { lookup: async () => ({ origin: null, updatedAt: null }) };
    const report = await new InspectVisitor([], dns(null), intel).execute(observation("18.228.4.5"), null);
    expect(report.signals.map((s) => s.label)).not.toContain("dono do bloco");
  });

  it("shows the headers and the browser traits as evidence", async () => {
    const report = await new InspectVisitor([], dns(null)).execute(observation("1.1.1.1"), {
      timezone: "America/Sao_Paulo",
      webgl: { renderer: "Apple GPU" },
      webdriver: false,
    });
    const labels = report.signals.map((s) => `${s.layer}:${s.label}`);
    expect(labels).toEqual(
      expect.arrayContaining(["rede:IP", "http:user-agent", "http:accept-language", "navegador:fuso", "navegador:GPU"]),
    );
    expect(report.signals).toContainEqual({ layer: "navegador", label: "webdriver", value: "false" });
    expect(report.summary.probe).toBe(true);
  });
});

describe("DnsReverseLookup", () => {
  it("returns the first PTR name", async () => {
    const lookup = new DnsReverseLookup(100, { reverse: async () => ["a.example", "b.example"] });
    expect(await lookup.lookup("1.1.1.1")).toBe("a.example");
  });

  it("gives up at the deadline and on resolver errors", async () => {
    const hang = new DnsReverseLookup(20, { reverse: () => new Promise(() => {}) });
    expect(await hang.lookup("1.1.1.1")).toBeNull();
    const fail = new DnsReverseLookup(20, { reverse: async () => Promise.reject(new Error("ENOTFOUND")) });
    expect(await fail.lookup("1.1.1.1")).toBeNull();
  });
});
