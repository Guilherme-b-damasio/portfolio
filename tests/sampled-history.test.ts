import { describe, expect, it } from "vitest";
import type { MetricsSnapshot, MetricsStore } from "../src/domain/metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";

function fakeStore() {
  let rpm = 0;
  const store: MetricsStore = {
    record: () => {},
    prometheus: () => "",
    snapshot: () => ({ requestsLastMinute: rpm++, memory: { rssMb: 60, heapUsedMb: 10 } }) as MetricsSnapshot,
  };
  return store;
}

describe("SampledHistory", () => {
  it("records one point per sample with the clock's timestamp", () => {
    let now = 1000;
    const history = new SampledHistory(fakeStore(), 60_000, 10, () => now);
    history.sample();
    now = 61_000;
    history.sample();
    expect(history.points()).toEqual([
      { t: 1000, requestsLastMinute: 0, rssMb: 60 },
      { t: 61_000, requestsLastMinute: 1, rssMb: 60 },
    ]);
  });

  it("keeps only the newest points once full", () => {
    const history = new SampledHistory(fakeStore(), 60_000, 3);
    for (let i = 0; i < 5; i++) history.sample();
    expect(history.points().map((p) => p.requestsLastMinute)).toEqual([2, 3, 4]);
  });

  it("hands out a copy, so callers cannot change the buffer", () => {
    const history = new SampledHistory(fakeStore());
    history.sample();
    history.points().pop();
    expect(history.points()).toHaveLength(1);
  });
});
