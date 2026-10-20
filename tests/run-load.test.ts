import { describe, expect, it } from "vitest";
import { RunLoad, summarize } from "../src/application/run-load.js";
import type { LoadTarget } from "../src/domain/load.js";

/** A target that answers after a tick, recording how many requests were in flight at once. */
function fakeTarget(answer: (n: number) => { status: number; ms: number } | Error = () => ({ status: 200, ms: 5 })) {
  let calls = 0;
  let inFlight = 0;
  let peak = 0;
  const target: LoadTarget = {
    name: "fake",
    path: "/fake",
    async hit() {
      const n = ++calls;
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      const result = answer(n);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { target, calls: () => calls, peak: () => peak };
}

const signal = () => new AbortController().signal;

describe("RunLoad", () => {
  it("fires exactly the planned requests, never more than the concurrency at once", async () => {
    const fake = fakeTarget();
    const seen: number[] = [];
    const summary = await new RunLoad().run(
      fake.target,
      { target: "fake", requests: 25, concurrency: 4 },
      { onSample: (s) => seen.push(s.index), signal: signal() },
    );
    expect(fake.calls()).toBe(25);
    expect(fake.peak()).toBe(4);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(summary).toMatchObject({ requests: 25, concurrency: 4, ok: 25, failed: 0, p50Ms: 5 });
  });

  it("counts a request that throws as status 0 and keeps going", async () => {
    const fake = fakeTarget((n) => (n === 2 ? new Error("refused") : { status: n === 3 ? 503 : 200, ms: 1 }));
    const statuses: number[] = [];
    const summary = await new RunLoad().run(
      fake.target,
      { target: "fake", requests: 4, concurrency: 1 },
      { onSample: (s) => statuses.push(s.status), signal: signal() },
    );
    expect(statuses).toEqual([200, 0, 503, 200]);
    expect(summary).toMatchObject({ ok: 2, failed: 2 });
  });

  it("stops firing once the signal aborts", async () => {
    const abort = new AbortController();
    const fake = fakeTarget((n) => {
      if (n === 3) abort.abort();
      return { status: 200, ms: 1 };
    });
    const summary = await new RunLoad().run(
      fake.target,
      { target: "fake", requests: 100, concurrency: 1 },
      { signal: abort.signal },
    );
    expect(fake.calls()).toBe(3);
    expect(summary.requests).toBe(3);
  });

  it("summarizes with nearest-rank percentiles and requests per second", () => {
    const samples = Array.from({ length: 100 }, (_, i) => ({ index: i + 1, status: 200, ms: i + 1 }));
    expect(summarize({ target: "t", requests: 100, concurrency: 5 }, samples, 2000)).toEqual({
      target: "t",
      requests: 100,
      concurrency: 5,
      ok: 100,
      failed: 0,
      durationMs: 2000,
      rps: 50,
      p50Ms: 50,
      p95Ms: 95,
      p99Ms: 99,
      maxMs: 100,
    });
    expect(summarize({ target: "t", requests: 0, concurrency: 1 }, [], 0)).toMatchObject({ p95Ms: 0, rps: 0 });
  });
});
