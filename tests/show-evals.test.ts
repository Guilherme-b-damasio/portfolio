import { describe, expect, it } from "vitest";
import { ShowEvals } from "../src/application/show-evals.js";
import type { EvalSet } from "../src/domain/evaluation.js";
import { type Hit, type Retriever, RetrieverUnavailable } from "../src/domain/search.js";

const set: EvalSet = { k: 3, minRecall: 0.5, cases: [{ question: "q", expected: ["a.md"] }] };
const hit = (source: string): Hit => ({ chunk: { id: source, source, text: "" }, score: 1, matchedTerms: [] });

const counting = (search: Retriever["search"]) => {
  let calls = 0;
  return { retriever: { search: (q: string, k?: number) => (calls++, search(q, k)) }, calls: () => calls };
};

describe("ShowEvals", () => {
  it("runs the eval for an engine and lists the engines", async () => {
    const local = counting(() => [hit("a.md › Intro")]);
    const evals = new ShowEvals(set, { local: local.retriever });
    expect(evals.engineNames).toEqual(["local"]);
    expect(await evals.report("local")).toMatchObject({ engine: "local", recall: 1, passed: true });
    expect(evals.report("nope")).toBeNull();
  });

  it("reuses a report within the window, shares one in flight and runs again after it", async () => {
    let now = 0;
    const local = counting(() => [hit("a.md")]);
    const evals = new ShowEvals(set, { local: local.retriever }, { ttlMs: 1000, now: () => now });

    await Promise.all([evals.report("local"), evals.report("local")]);
    now = 999;
    await evals.report("local");
    expect(local.calls()).toBe(1);

    now = 1000;
    await evals.report("local");
    expect(local.calls()).toBe(2);
  });

  it("reports a failing engine with a reason safe to show, and caches that too", async () => {
    const docsage = counting(() => {
      throw new RetrieverUnavailable("docsage está fora do ar");
    });
    const hidden = counting(() => {
      throw new Error("ECONNREFUSED 10.0.0.7");
    });
    const evals = new ShowEvals(set, { docsage: docsage.retriever, other: hidden.retriever }, { now: () => 0 });

    expect(await evals.report("docsage")).toEqual({
      engine: "docsage",
      error: "docsage está fora do ar",
      ranAt: "1970-01-01T00:00:00.000Z",
    });
    await evals.report("docsage");
    expect(docsage.calls()).toBe(1);
    expect(await evals.report("other")).toMatchObject({ error: "other falhou" });
  });
});
