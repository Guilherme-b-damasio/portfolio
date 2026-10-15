import { describe, expect, it } from "vitest";
import { EvaluateRetrieval } from "../src/application/evaluate-retrieval.js";
import { matchesExpected } from "../src/domain/evaluation.js";
import type { Hit, Retriever } from "../src/domain/search.js";

const hit = (source: string): Hit => ({ chunk: { id: source, source, text: "" }, score: 1, matchedTerms: [] });

// Answers each question with the sources listed for it, best first.
const scripted = (answers: Record<string, string[]>): Retriever & { ks: (number | undefined)[] } => {
  const ks: (number | undefined)[] = [];
  return { ks, search: (q, k) => (ks.push(k), (answers[q] ?? []).slice(0, k).map(hit)) };
};

describe("EvaluateRetrieval", () => {
  it("computes recall@k and MRR from where the first expected source landed", async () => {
    const retriever = scripted({
      a: ["x.md › Intro", "docsage.md › O que é"],
      b: ["profile.md › Stack"],
      c: ["x.md", "y.md", "z.md", "profile.md › Formação"],
    });
    const report = await new EvaluateRetrieval(retriever, "local", () => new Date("2026-10-15T12:00:00Z")).run({
      k: 3,
      minRecall: 0.6,
      cases: [
        { question: "a", expected: ["docsage.md"] },
        { question: "b", expected: ["profile.md › Stack"] },
        { question: "c", expected: ["profile.md › Formação"] },
      ],
    });

    expect(retriever.ks).toEqual([3, 3, 3]);
    expect(report.cases.map((c) => c.rank)).toEqual([2, 1, null]);
    expect(report.cases[2].retrieved).toEqual(["x.md", "y.md", "z.md"]);
    expect(report).toMatchObject({ engine: "local", k: 3, recall: 0.667, mrr: 0.5, passed: true });
    expect(report.ranAt).toBe("2026-10-15T12:00:00.000Z");
  });

  it("fails the report below the minimum recall", async () => {
    const report = await new EvaluateRetrieval(scripted({})).run({
      k: 3,
      minRecall: 0.5,
      cases: [{ question: "a", expected: ["a.md"] }],
    });
    expect(report).toMatchObject({ recall: 0, mrr: 0, passed: false });
  });
});

describe("matchesExpected", () => {
  it("takes a file for any of its sections, and a section only for itself", () => {
    expect(matchesExpected("docsage.md › O que é", "docsage.md")).toBe(true);
    expect(matchesExpected("docsage.md", "docsage.md")).toBe(true);
    expect(matchesExpected("docsage.md › O que é", "docsage.md › Decisões técnicas")).toBe(false);
    expect(matchesExpected("docsage.mdx", "docsage.md")).toBe(false);
  });
});
