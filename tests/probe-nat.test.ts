import { describe, expect, it } from "vitest";
import { ProbeNat } from "../src/application/probe-nat.js";
import type { NatBindings, StunSighting } from "../src/domain/stun.js";

const SERVERS = [
  { host: null, port: 3478 },
  { host: null, port: 3479 },
];

function bindings(sightings: Record<string, Omit<StunSighting, "at" | "address">[]>): NatBindings {
  return {
    record: () => {},
    forAddress: (address) => (sightings[address] ?? []).map((s) => ({ ...s, address, at: "2026-10-22T12:00:00.000Z" })),
  };
}

const seen = (port: number, serverPort: number) => ({ port, serverPort, software: null });

describe("probe nat", () => {
  it("says nothing arrived while no socket was reached", () => {
    const report = new ProbeNat(bindings({}), SERVERS).report("203.0.113.9");
    expect(report).toMatchObject({
      pending: true,
      verdict: "info",
      mapping: "desconhecido",
      matchesHttp: null,
      sightings: [],
      servers: SERVERS,
    });
    expect(report.headline).toMatch(/nenhuma requisição/);
  });

  it("calls the mapping fixed when both sockets saw the same port", () => {
    const store = bindings({ "203.0.113.9": [seen(54321, 3478), seen(54321, 3479)] });
    const report = new ProbeNat(store, SERVERS).report("::ffff:203.0.113.9");
    expect(report.you.ip).toBe("203.0.113.9");
    expect(report.mapping).toBe("porta-fixa");
    expect(report.matchesHttp).toBe(true);
    expect(report.pending).toBe(false);
    expect(report.sightings).toEqual([
      { port: 54321, serverPorts: [3478, 3479], software: null, at: "2026-10-22T12:00:00.000Z" },
    ]);
    expect(report.verdict).toBe("info");
  });

  it("calls it port-dependent when each socket saw its own port", () => {
    const store = bindings({ "203.0.113.9": [seen(54321, 3478), seen(54330, 3479)] });
    const report = new ProbeNat(store, SERVERS).report("203.0.113.9");
    expect(report.mapping).toBe("porta-por-destino");
    expect(report.verdict).toBe("ok");
    expect(report.headline).toMatch(/troca a porta/);
    expect(report.sightings.map((s) => s.port)).toEqual([54321, 54330]);
  });

  it("keeps the mapping unknown when only one socket was reached", () => {
    const store = bindings({ "203.0.113.9": [seen(54321, 3478), seen(54322, 3478)] });
    const report = new ProbeNat(store, SERVERS).report("203.0.113.9");
    expect(report.mapping).toBe("desconhecido");
    expect(report.verdict).toBe("info");
  });

  it("flags the UDP leaving by another address, without looking that address up", () => {
    const asked: string[] = [];
    const store: NatBindings = {
      record: () => {},
      forAddress: (address) => {
        asked.push(address);
        return [];
      },
    };
    const report = new ProbeNat(store, SERVERS).report("203.0.113.9", [{ address: "198.51.100.7", port: 40000 }]);
    expect(asked).toEqual(["203.0.113.9"]);
    expect(report.verdict).toBe("contradicao");
    expect(report.matchesHttp).toBe(false);
    expect(report.headline).toContain("198.51.100.7");
    expect(report.browser).toEqual([{ address: "198.51.100.7", port: 40000 }]);
  });

  it("calls another family dual stack, not a leak: these sockets only speak IPv4", () => {
    const report = new ProbeNat(bindings({}), SERVERS).report("2001:db8::1", [{ address: "203.0.113.9", port: 40000 }]);
    expect(report.verdict).toBe("info");
    expect(report.headline).toMatch(/IPv6 e o UDP saiu por IPv4/);
  });

  it("does not call it a leak when the browser reports the same address this page came over", () => {
    const store = bindings({});
    const report = new ProbeNat(store, SERVERS).report("203.0.113.9", [{ address: "203.0.113.9", port: 40000 }]);
    expect(report.matchesHttp).toBe(true);
    expect(report.verdict).toBe("info");
    expect(report.detail).toMatch(/réplica/);
  });

  it("prefers what it saw itself over what the browser says", () => {
    const store = bindings({ "203.0.113.9": [seen(54321, 3478), seen(54321, 3479)] });
    const report = new ProbeNat(store, SERVERS).report("203.0.113.9", [{ address: "198.51.100.7", port: 40000 }]);
    expect(report.matchesHttp).toBe(true);
    expect(report.mapping).toBe("porta-fixa");
  });
});
