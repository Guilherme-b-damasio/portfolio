import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { TokenBucket } from "../src/http/middleware/rate-limit.js";
import { labRouter } from "../src/http/routes/lab.js";

let server: Server | null = null;
afterEach(() => server?.close());

async function serve(bucket: TokenBucket) {
  server = express().use("/api/lab", labRouter(bucket)).listen(0);
  await new Promise((resolve) => server!.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/lab/ratelimit`;
}

const headers = (res: Response) => ({
  status: res.status,
  limit: res.headers.get("x-ratelimit-limit"),
  remaining: res.headers.get("x-ratelimit-remaining"),
  reset: res.headers.get("x-ratelimit-reset"),
  retryAfter: res.headers.get("retry-after"),
});

describe("/api/lab/ratelimit", () => {
  it("spends one token per shot and refuses with Retry-After once the bucket is empty", async () => {
    const url = await serve(new TokenBucket(3, 20, () => 0));
    const shots = [];
    for (let i = 0; i < 4; i++) shots.push(headers(await fetch(url)));
    expect(shots).toEqual([
      { status: 200, limit: "3", remaining: "2", reset: "3", retryAfter: null },
      { status: 200, limit: "3", remaining: "1", reset: "6", retryAfter: null },
      { status: 200, limit: "3", remaining: "0", reset: "9", retryAfter: null },
      { status: 429, limit: "3", remaining: "0", reset: "9", retryAfter: "3" },
    ]);
  });

  it("refills over time", async () => {
    let now = 0;
    const url = await serve(new TokenBucket(2, 20, () => now));
    await fetch(url);
    await fetch(url);
    expect((await fetch(url)).status).toBe(429);
    now = 3_000;
    expect(headers(await fetch(url))).toMatchObject({ status: 200, remaining: "0" });
  });

  it("shows the balance without spending, and is never cached", async () => {
    const url = await serve(new TokenBucket(3, 20, () => 0));
    await fetch(url);
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${url}/bucket`);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({
        limit: 3,
        remaining: 2,
        refillPerMinute: 20,
        retryAfterSeconds: 0,
        resetSeconds: 3,
      });
    }
  });
});
