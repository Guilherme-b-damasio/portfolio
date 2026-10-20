import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { LoopbackTarget } from "../src/infrastructure/load/loopback-target.js";

let server: Server | null = null;
afterEach(() => server?.close());

async function serve() {
  const app = express();
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/slow", (_req, res) => {
    setTimeout(() => res.json({ ok: true }), 200);
  });
  server = app.listen(0);
  await new Promise((resolve) => server!.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("LoopbackTarget", () => {
  it("hits a fixed path of the local server and times the whole response", async () => {
    const base = await serve();
    const result = await new LoopbackTarget("healthz", "/healthz", base).hit(new AbortController().signal);
    expect(result.status).toBe(200);
    expect(result.ms).toBeGreaterThan(0);
  });

  it("gives up past its timeout or when the run is aborted, as status 0", async () => {
    const base = await serve();
    const slow = new LoopbackTarget("slow", "/slow", base, 20);
    expect((await slow.hit(new AbortController().signal)).status).toBe(0);

    const abort = new AbortController();
    abort.abort();
    expect((await new LoopbackTarget("slow", "/slow", base).hit(abort.signal)).status).toBe(0);
  });

  it("answers status 0 when nothing listens there", async () => {
    const target = new LoopbackTarget("x", "/healthz", "http://127.0.0.1:1", 500);
    expect((await target.hit(new AbortController().signal)).status).toBe(0);
  });
});
