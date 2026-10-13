import { describe, expect, it } from "vitest";
import { ConcurrencyGate } from "../src/http/middleware/concurrency.js";

describe("ConcurrencyGate", () => {
  it("hands out slots up to the limit and refuses the rest", () => {
    const gate = new ConcurrencyGate(2);
    const a = gate.tryAcquire();
    const b = gate.tryAcquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
    expect(gate.inFlight).toBe(2);
  });

  it("frees a slot on release, and releasing twice frees only one", () => {
    const gate = new ConcurrencyGate(1);
    const release = gate.tryAcquire()!;
    release();
    release();
    expect(gate.inFlight).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
  });
});
