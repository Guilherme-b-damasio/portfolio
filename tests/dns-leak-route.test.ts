import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { TestDnsLeak } from "../src/application/test-dns-leak.js";
import { TokenBucket } from "../src/http/middleware/rate-limit.js";
import { dnsLeakRouter } from "../src/http/routes/dns-leak.js";
import { InMemoryLeakProbes } from "../src/infrastructure/dns/in-memory-leak-probes.js";

let server: Server | null = null;
afterEach(() => server?.close());

async function serve(leak: TestDnsLeak | null, starts?: TokenBucket) {
  server = express().use("/api/dns-leak", dnsLeakRouter(leak, starts)).listen(0);
  await new Promise((resolve) => server!.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/dns-leak`;
}

describe("/api/dns-leak", () => {
  it("hands out a name, then reports the resolvers that asked for it", async () => {
    const probes = new InMemoryLeakProbes("leak.example.test");
    const url = await serve(new TestDnsLeak(probes, { lookup: async () => null }));

    const started = await fetch(url, { method: "POST" });
    expect(started.status).toBe(201);
    expect(started.headers.get("cache-control")).toBe("no-store");
    const { token, hostname } = await started.json();
    expect(hostname).toBe(`${token}.leak.example.test`);

    expect(await (await fetch(`${url}/${token}`)).json()).toMatchObject({ pending: true, resolvers: [] });
    probes.record(token, { address: "8.8.8.8", qtype: "A", clientSubnet: null });
    expect(await (await fetch(`${url}/${token}`)).json()).toMatchObject({
      pending: false,
      resolvers: [{ address: "8.8.8.8", operator: "Google" }],
    });
  });

  it("refuses bad and unknown tokens", async () => {
    const url = await serve(new TestDnsLeak(new InMemoryLeakProbes("z.test"), { lookup: async () => null }));
    expect((await fetch(`${url}/nope`)).status).toBe(400);
    expect((await fetch(`${url}/ffffffffffffffff`)).status).toBe(404);
  });

  it("limits how many tests a visitor starts, and how many run at once", async () => {
    const full = new InMemoryLeakProbes("z.test", { maxProbes: 1 });
    const url = await serve(new TestDnsLeak(full, { lookup: async () => null }), new TokenBucket(2, 1, () => 0));
    expect((await fetch(url, { method: "POST" })).status).toBe(201);
    const busy = await fetch(url, { method: "POST" });
    expect([busy.status, busy.headers.get("retry-after")]).toEqual([503, "30"]);
    expect((await fetch(url, { method: "POST" })).status).toBe(429);
  });

  it("says when the test is off", async () => {
    const url = await serve(null);
    const res = await fetch(url, { method: "POST" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ off: true });
  });
});
