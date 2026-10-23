import { describe, expect, it } from "vitest";
import { registeredDomain, TestDnsLeak } from "../src/application/test-dns-leak.js";
import { inPrefix, ipBytes } from "../src/domain/ip.js";
import type { ClientSubnet } from "../src/domain/dns-leak.js";
import { InMemoryLeakProbes } from "../src/infrastructure/dns/in-memory-leak-probes.js";

const PTR: Record<string, string> = {
  "189.100.20.30": "bd641e1e.virtua.com.br",
  "201.17.0.53": "dns1.virtua.com.br",
  "8.8.8.8": "dns.google",
  "185.220.101.4": "exit.vpn-provider.net",
};

function setup() {
  const probes = new InMemoryLeakProbes("leak.example.test");
  const leak = new TestDnsLeak(probes, { lookup: async (ip) => PTR[ip] ?? null });
  const { token } = leak.start()!;
  const asked = (address: string, clientSubnet: ClientSubnet | null = null, qtype = "A") =>
    probes.record(token, { address, qtype, clientSubnet });
  return { leak, token, asked };
}

describe("DNS leak test", () => {
  it("says nothing asked yet, and nothing at all for an unknown token", async () => {
    const { leak, token } = setup();
    await expect(leak.report(token, "189.100.20.30")).resolves.toMatchObject({
      pending: true,
      resolvers: [],
      verdict: "info",
    });
    await expect(leak.report("ffffffffffffffff", "189.100.20.30")).resolves.toBeNull();
  });

  it("is fine with the visitor's own ISP resolver, matched by the operator's domain", async () => {
    const { leak, token, asked } = setup();
    asked("201.17.0.53");
    asked("201.17.0.53", null, "AAAA");
    const report = await leak.report(token, "::ffff:189.100.20.30");
    expect(report).toMatchObject({
      you: { ip: "189.100.20.30", reverseDns: "bd641e1e.virtua.com.br" },
      verdict: "ok",
      resolvers: [{ relation: "mesma-rede", qtypes: ["A", "AAAA"], reverseDns: "dns1.virtua.com.br", operator: null }],
    });
  });

  it("names public resolvers by PTR or by egress range", async () => {
    const { leak, token, asked } = setup();
    asked("8.8.8.8");
    asked("172.253.4.9"); // Google's egress, no PTR
    asked("162.158.10.1"); // Cloudflare's
    const report = await leak.report(token, "189.100.20.30");
    expect(report!.resolvers.map((r) => r.operator)).toEqual(["Google", "Google", "Cloudflare"]);
    expect(report).toMatchObject({ verdict: "info", headline: "você usa o resolvedor público Google" });
  });

  it("flags a resolver from another network, the shape of a VPN leaking DNS", async () => {
    const { leak, token, asked } = setup();
    asked("201.17.0.53"); // the ISP's resolver, while the page came through the VPN's exit
    const report = await leak.report(token, "185.220.101.4");
    expect(report).toMatchObject({ verdict: "exposto", resolvers: [{ relation: "outra-rede" }] });
  });

  it("calls it a contradiction when the forwarded subnet is not where the page came from", async () => {
    const { leak, token, asked } = setup();
    asked("172.253.4.9", { family: 4, address: "189.100.20.0", prefix: 24 });
    const leaked = await leak.report(token, "185.220.101.4");
    expect(leaked).toMatchObject({ verdict: "contradicao", resolvers: [{ subnetHasYou: false }] });
    expect(leaked!.detail).toContain("189.100.20.0/24");

    const honest = await leak.report(token, "189.100.20.30");
    expect(honest).toMatchObject({ verdict: "exposto", resolvers: [{ subnetHasYou: true }] });
  });
});

describe("address helpers", () => {
  it("reads both families and matches prefixes bit by bit", () => {
    expect(ipBytes("10.0.0.256")).toBeNull();
    expect(ipBytes("::1")).toEqual([...Array(15).fill(0), 1]);
    expect(ipBytes("1::2::3")).toBeNull();
    expect(inPrefix("172.67.1.1", "172.64.0.0", 13)).toBe(true);
    expect(inPrefix("172.72.0.1", "172.64.0.0", 13)).toBe(false);
    expect(inPrefix("2804:14c:12:34ff::9", "2804:14c:12:3400::", 56)).toBe(true);
    expect(inPrefix("2804:14c:12:3500::9", "2804:14c:12:3400::", 56)).toBe(false);
    expect(inPrefix("10.0.0.1", "::", 0)).toBe(false);
  });

  it("finds the registered domain, country-code second levels included", () => {
    expect(registeredDomain("dns1.virtua.com.br.")).toBe("virtua.com.br");
    expect(registeredDomain("resolver1.opendns.com")).toBe("opendns.com");
    expect(registeredDomain("localhost")).toBeNull();
    expect(registeredDomain(null)).toBeNull();
  });
});
