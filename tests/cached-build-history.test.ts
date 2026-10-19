import { describe, expect, it } from "vitest";
import { CachedBuildHistory } from "../src/infrastructure/delivery/cached-build-history.js";
import { FakeBuildHistory, fakeBuild } from "./fakes/fake-build-history.js";

function setup() {
  const inner = new FakeBuildHistory();
  let now = 0;
  const history = new CachedBuildHistory(inner, 300_000, () => now);
  return { inner, history, tick: (ms: number) => (now += ms) };
}

describe("CachedBuildHistory", () => {
  it("calls GitHub at most once per window, however many visitors ask", async () => {
    const { inner, history, tick } = setup();
    const answers = await Promise.all(Array.from({ length: 30 }, () => history.builds()));
    expect(answers.every((a) => a[0] === fakeBuild)).toBe(true);
    expect(inner.calls).toBe(1);
    tick(299_999);
    await history.builds();
    expect(inner.calls).toBe(1);
    tick(1);
    await history.builds();
    expect(inner.calls).toBe(2);
  });

  it("does not keep a failure, so the next visitor tries again", async () => {
    const { inner, history } = setup();
    inner.down = true;
    await expect(history.builds()).rejects.toThrow(/fora de alcance/);
    inner.down = false;
    await expect(history.builds()).resolves.toEqual([fakeBuild]);
    expect(inner.calls).toBe(2);
  });
});
