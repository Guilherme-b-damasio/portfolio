import { describe, expect, it } from "vitest";
import { InMemoryTraces } from "../src/infrastructure/tracing/in-memory-traces.js";

function fakeClock() {
  let ms = 0;
  return { now: () => ms, advance: (by: number) => (ms += by) };
}

describe("InMemoryTraces", () => {
  it("records each step with its offset, duration and attributes once the request ends", async () => {
    const clock = fakeClock();
    let n = 0;
    const traces = new InMemoryTraces({ now: clock.now, newId: () => `t${++n}`, clock: () => new Date(0) });
    const trace = traces.start();
    clock.advance(2);
    const value = await trace.span(
      "retrieve",
      () => {
        clock.advance(5);
        return 42;
      },
      { engine: "local" },
    );
    expect(value).toBe(42);
    expect(traces.get("t1")).toBeNull(); // still running

    clock.advance(3);
    trace.end("POST /api/ask", 200);
    expect(traces.get("t1")).toEqual({
      id: "t1",
      route: "POST /api/ask",
      status: 200,
      startedAt: "1970-01-01T00:00:00.000Z",
      durationMs: 10,
      spans: [{ name: "retrieve", startMs: 2, durationMs: 5, error: false, attrs: { engine: "local" } }],
      droppedSpans: 0,
    });
  });

  it("marks a failed step and rethrows its error", async () => {
    const traces = new InMemoryTraces({ newId: () => "t" });
    const trace = traces.start();
    await expect(trace.span("generate", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    trace.end("POST /api/ask", 500);
    expect(traces.get("t")?.spans[0]).toMatchObject({ name: "generate", error: true });
  });

  it("caps the spans of one trace and counts the rest", async () => {
    const traces = new InMemoryTraces({ maxSpans: 2, newId: () => "t" });
    const trace = traces.start();
    for (const name of ["a", "b", "c", "d"]) await trace.span(name, () => null);
    trace.end("GET /api/x", 200);
    expect(traces.get("t")?.spans.map((s) => s.name)).toEqual(["a", "b"]);
    expect(traces.get("t")?.droppedSpans).toBe(2);
  });

  it("keeps only the newest traces and ignores a second end or a late step", async () => {
    let n = 0;
    const traces = new InMemoryTraces({ capacity: 2, newId: () => `t${++n}` });
    const started = [traces.start(), traces.start(), traces.start()];
    for (const t of started) t.end("GET /api/x", 200);
    expect([traces.get("t1"), traces.get("t2"), traces.get("t3")].map(Boolean)).toEqual([false, true, true]);

    started[2].end("GET /api/x", 500);
    await started[2].span("late", () => null);
    expect(traces.get("t3")).toMatchObject({ status: 200, spans: [] });
  });

  it("gives every trace a fresh random id", () => {
    const traces = new InMemoryTraces();
    const [a, b] = [traces.start().id, traces.start().id];
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });
});
