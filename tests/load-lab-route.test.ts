import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { LOAD_LIMITS, LoadLab } from "../src/application/load-lab.js";
import type { LoadTarget } from "../src/domain/load.js";
import { TokenBucket } from "../src/http/middleware/rate-limit.js";
import { loadLabRouter } from "../src/http/routes/load-lab.js";
import { JsonLogger } from "../src/infrastructure/logging/json-logger.js";

const quick: LoadTarget = { name: "healthz", path: "/healthz", hit: async () => ({ status: 200, ms: 2 }) };
// Never answers until the run is aborted, to hold the runner.
const stuck: LoadTarget = {
  name: "stuck",
  path: "/stuck",
  hit: (signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ status: 0, ms: 1 }))),
};

let server: Server | null = null;
afterEach(() => server?.close());

async function serve(lab: LoadLab, options: Parameters<typeof loadLabRouter>[2] = {}) {
  const logger = new JsonLogger(() => {});
  server = express()
    .use(express.json())
    .use("/api/lab/load", loadLabRouter(lab, logger, { bucket: new TokenBucket(100, 100, () => 0), ...options }))
    .listen(0);
  await new Promise((resolve) => server!.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/lab/load`;
}

const post = (url: string, body: unknown, signal?: AbortSignal) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });

/** The SSE body as [event, data] pairs. */
async function events(res: Response) {
  return (await res.text())
    .trim()
    .split("\n\n")
    .map((block) => {
      const [event, data] = block.split("\n").map((l) => l.slice(l.indexOf(":") + 2));
      return [event, JSON.parse(data)] as [string, Record<string, unknown>];
    });
}

describe("/api/lab/load", () => {
  it("streams the start, every sample and the summary", async () => {
    const url = await serve(new LoadLab([quick]));
    const res = await post(url, { target: "healthz", requests: 3, concurrency: 2 });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const stream = await events(res);
    expect(stream.map(([e]) => e)).toEqual(["start", "sample", "sample", "sample", "done"]);
    expect(stream[0][1]).toEqual({ target: "healthz", requests: 3, concurrency: 2, path: "/healthz" });
    expect(stream.at(-1)![1]).toMatchObject({ requests: 3, ok: 3, p50Ms: 2, timedOut: false });
  });

  it("refuses plans past the limits or aimed anywhere but its own targets", async () => {
    const url = await serve(new LoadLab([quick]));
    for (const body of [
      { target: "healthz", requests: 201, concurrency: 1 },
      { target: "healthz", requests: 10, concurrency: 11 },
      { target: "http://example.com", requests: 1, concurrency: 1 },
      { target: "healthz", requests: 1.5, concurrency: 1 },
    ]) {
      const res = await post(url, body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/requests de 1 a 200/);
    }
  });

  it("puts a second visitor in line, shows it in the state and stops the run at the timeout", async () => {
    const lab = new LoadLab([stuck, quick]);
    const url = await serve(lab, { timeoutMs: 150 });
    const first = post(url, { target: "stuck", requests: 1, concurrency: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const second = post(url, { target: "healthz", requests: 1, concurrency: 1 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await (await fetch(url)).json()).toMatchObject({ running: true, waiting: 1 });

    const firstEvents = await events(await first);
    expect(firstEvents.at(-1)).toEqual(["done", expect.objectContaining({ timedOut: true })]);
    const secondEvents = await events(await second);
    expect(secondEvents.map(([e]) => e)).toEqual(["queued", "start", "sample", "done"]);
    expect(secondEvents[0][1]).toEqual({ position: 1 });
  });

  it("answers 503 with Retry-After when the line is full, before spending a run", async () => {
    const lab = new LoadLab([stuck]);
    const bucket = new TokenBucket(LOAD_LIMITS.maxWaiting + 1, 1, () => 0);
    const url = await serve(lab, { bucket, timeoutMs: 5_000 });
    const abort = new AbortController();
    const held = Array.from({ length: LOAD_LIMITS.maxWaiting + 1 }, () =>
      post(url, { target: "stuck", requests: 1, concurrency: 1 }, abort.signal).catch(() => null),
    );
    while (lab.state.waiting < LOAD_LIMITS.maxWaiting) await new Promise((resolve) => setTimeout(resolve, 10));

    const refused = await post(url, { target: "stuck", requests: 1, concurrency: 1 });
    expect(refused.status).toBe(503);
    expect(refused.headers.get("retry-after")).toBe("10");
    abort.abort();
    await Promise.all(held);
  });
});
