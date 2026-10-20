import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { TuneSearch } from "../src/application/tune-search.js";
import { TokenBucket } from "../src/http/middleware/rate-limit.js";
import { searchLabRouter } from "../src/http/routes/search-lab.js";
import { Bm25Retriever } from "../src/infrastructure/search/bm25-retriever.js";

const chunks = [
  { id: "short", source: "s.md › A", text: "kubernetes" },
  { id: "long", source: "l.md › B", text: "kubernetes kubernetes kubernetes flux helm ingress traefik pods logs" },
];

let server: Server | null = null;
afterEach(() => server?.close());

async function serve(bucket = new TokenBucket(60, 120, () => 0)) {
  const tune = new TuneSearch(new Bm25Retriever(chunks, 1.5, 0.75, (t) => t));
  server = express().use("/api/lab/search", searchLabRouter(tune, bucket)).listen(0);
  await new Promise((resolve) => server!.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/lab/search`;
}

describe("/api/lab/search", () => {
  it("reorders the ranking as the visitor moves b, against the server's defaults", async () => {
    const url = await serve();
    const flat = await (await fetch(`${url}?q=kubernetes&b=0`)).json();
    expect(flat.params).toEqual({ k1: 1.5, b: 0, k: 4 });
    expect(flat.hits.map((h: { id: string; defaultRank: number }) => [h.id, h.defaultRank])).toEqual([
      ["long", 2],
      ["short", 1],
    ]);
    const normalised = await (await fetch(`${url}?q=kubernetes&b=1&k1=2&k=1`)).json();
    expect(normalised.hits.map((h: { id: string }) => h.id)).toEqual(["short"]);
    expect(normalised.hits[0].terms[0]).toMatchObject({ term: "kubernetes", tf: 1, df: 2 });
  });

  it("refuses parameters out of range and queries too short or too long", async () => {
    const url = await serve();
    for (const query of [
      "q=k",
      `q=${"a".repeat(201)}`,
      "q=kubernetes&b=2",
      "q=kubernetes&k1=-1",
      "q=kubernetes&k=1.5",
    ]) {
      const res = await fetch(`${url}?${query}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/k1 de 0 a 3/);
    }
  });

  it("serves the sliders' ranges and defaults, without spending the bucket", async () => {
    const url = await serve(new TokenBucket(1, 1, () => 0));
    for (let i = 0; i < 2; i++)
      expect(await (await fetch(`${url}/params`)).json()).toEqual({
        limits: { k1: { min: 0, max: 3 }, b: { min: 0, max: 1 }, k: { min: 1, max: 10 } },
        defaults: { k1: 1.5, b: 0.75, k: 4 },
      });
  });

  it("is bounded by a bucket of its own, answered in the rate limit headers", async () => {
    const url = await serve(new TokenBucket(2, 120, () => 0));
    expect((await fetch(`${url}?q=kubernetes`)).status).toBe(200);
    expect((await fetch(`${url}?q=kubernetes`)).headers.get("x-ratelimit-remaining")).toBe("0");
    const refused = await fetch(`${url}?q=kubernetes`);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("1");
  });
});
