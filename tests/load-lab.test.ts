import { describe, expect, it } from "vitest";
import { LOAD_LIMITS, LoadLab } from "../src/application/load-lab.js";
import { LoadLabBusy, type LoadPlan, type LoadTarget } from "../src/domain/load.js";

/** A target whose requests hang until released, so a test decides when a run ends. */
function gatedTarget() {
  const pending: (() => void)[] = [];
  let calls = 0;
  const target: LoadTarget = {
    name: "healthz",
    path: "/healthz",
    hit: () =>
      new Promise((resolve) => {
        calls++;
        pending.push(() => resolve({ status: 200, ms: 1 }));
      }),
  };
  const releaseAll = async () => {
    while (pending.length) pending.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { target, releaseAll, calls: () => calls };
}

const plan = (requests = 1): LoadPlan => ({ target: "healthz", requests, concurrency: 1 });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("LoadLab", () => {
  it("runs one plan at a time and starts the next in line as soon as the runner is free", async () => {
    const gate = gatedTarget();
    const lab = new LoadLab([gate.target]);
    const order: string[] = [];
    const positions: number[] = [];

    const first = lab.run(plan(), { onStart: () => order.push("a") }, new AbortController().signal);
    const second = lab.run(
      plan(),
      { onQueued: (p) => positions.push(p), onStart: () => order.push("b") },
      new AbortController().signal,
    );
    await tick();
    expect(order).toEqual(["a"]);
    expect(lab.state).toMatchObject({ running: true, waiting: 1 });

    await gate.releaseAll();
    await first;
    await tick();
    expect(order).toEqual(["a", "b"]);
    await gate.releaseAll();
    await second;
    expect(positions).toEqual([1]);
    expect(lab.state).toMatchObject({ running: false, waiting: 0 });
  });

  it("moves everyone up when someone leaves the line, and turns away past the line's size", async () => {
    const gate = gatedTarget();
    const lab = new LoadLab([gate.target]);
    void lab.run(plan(), {}, new AbortController().signal);

    const leaving = new AbortController();
    const left = lab.run(plan(), {}, leaving.signal);
    const lastPositions: number[] = [];
    const rest = Array.from({ length: LOAD_LIMITS.maxWaiting - 1 }, (_, i) =>
      lab.run(plan(), { onQueued: (p) => (lastPositions[i] = p) }, new AbortController().signal),
    );
    await expect(lab.run(plan(), {}, new AbortController().signal)).rejects.toBeInstanceOf(LoadLabBusy);

    leaving.abort(new Error("visitor left"));
    await expect(left).rejects.toThrow("visitor left");
    expect(lastPositions).toEqual([1, 2, 3, 4]);
    expect(lab.state.waiting).toBe(LOAD_LIMITS.maxWaiting - 1);

    for (let i = 0; i <= rest.length; i++) await gate.releaseAll();
    await Promise.all(rest);
    expect(gate.calls()).toBe(LOAD_LIMITS.maxWaiting);
  });

  it("clamps the plan to the limits and refuses unknown targets", async () => {
    const lab = new LoadLab([{ name: "healthz", path: "/healthz", hit: async () => ({ status: 200, ms: 1 }) }]);
    let started: unknown;
    const summary = await lab.run(
      { target: "healthz", requests: 5000, concurrency: 99 },
      { onStart: (p) => (started = p) },
      new AbortController().signal,
    );
    expect(started).toEqual({ target: "healthz", requests: 200, concurrency: 10, path: "/healthz" });
    expect(summary.requests).toBe(200);
    await expect(
      lab.run({ ...plan(), target: "https://example.com" }, {}, new AbortController().signal),
    ).rejects.toThrow(RangeError);
  });
});
