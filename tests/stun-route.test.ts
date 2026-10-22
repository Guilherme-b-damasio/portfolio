import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { ProbeNat } from "../src/application/probe-nat.js";
import { TokenBucket } from "../src/http/middleware/rate-limit.js";
import { stunRouter } from "../src/http/routes/stun.js";
import { InMemoryNatBindings } from "../src/infrastructure/stun/in-memory-bindings.js";

let server: Server | null = null;
afterEach(() => server?.close());

const SERVERS = [
  { host: "stun.example.test", port: 3478 },
  { host: "stun.example.test", port: 3479 },
];

async function serve(probe: ProbeNat | null, reads?: TokenBucket) {
  server = express().use(express.json()).use("/api/stun", stunRouter(probe, reads)).listen(0);
  await new Promise((resolve) => server!.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/stun`;
}

describe("/api/stun", () => {
  it("lists the sockets to aim at, then what they saw", async () => {
    const bindings = new InMemoryNatBindings();
    const url = await serve(new ProbeNat(bindings, SERVERS));

    const empty = await fetch(url);
    expect(empty.headers.get("cache-control")).toBe("no-store");
    expect(await empty.json()).toMatchObject({ pending: true, servers: SERVERS, sightings: [] });

    for (const serverPort of [3478, 3479])
      bindings.record({ address: "127.0.0.1", port: 54321, serverPort, software: null });
    expect(await (await fetch(url)).json()).toMatchObject({
      pending: false,
      mapping: "porta-fixa",
      sightings: [{ port: 54321, serverPorts: [3478, 3479] }],
    });
  });

  it("compares the address the browser reports with the one the page came over", async () => {
    const url = await serve(new ProbeNat(new InMemoryNatBindings(), SERVERS));
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidates: [{ address: "198.51.100.7", port: 40000 }] }),
    });
    expect(await response.json()).toMatchObject({ verdict: "contradicao", matchesHttp: false });
  });

  it("refuses candidates that are not addresses and ports", async () => {
    const url = await serve(new ProbeNat(new InMemoryNatBindings(), SERVERS));
    const post = (candidates: unknown) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidates }),
      });
    expect((await post([{ address: "oi tudo bem", port: 1 }])).status).toBe(400);
    expect((await post([{ address: "203.0.113.9", port: 99_999 }])).status).toBe(400);
    expect((await post(Array(9).fill({ address: "203.0.113.9", port: 40_000 }))).status).toBe(400);
    expect((await post(undefined)).status).toBe(200); // nothing to compare is not an error
  });

  it("limits the reads and says so when the test is off", async () => {
    const url = await serve(new ProbeNat(new InMemoryNatBindings(), SERVERS), new TokenBucket(1, 1));
    expect((await fetch(url)).status).toBe(200);
    const limited = await fetch(url);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();

    server?.close();
    const off = await serve(null);
    const response = await fetch(off);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ off: true });
  });
});
