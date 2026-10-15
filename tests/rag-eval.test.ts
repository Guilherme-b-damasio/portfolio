import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvaluateRetrieval } from "../src/application/evaluate-retrieval.js";
import { MarkdownContentSource } from "../src/infrastructure/content/markdown-content-source.js";
import { matchesExpected } from "../src/domain/evaluation.js";
import { loadEvalSet } from "../src/infrastructure/evals/json-eval-set.js";
import { Bm25Retriever } from "../src/infrastructure/search/bm25-retriever.js";
import { chunkContent } from "../src/infrastructure/search/chunker.js";

// The eval gate: the real content, the real index and the shipped questions. CI fails if recall drops.
const root = path.resolve(import.meta.dirname, "..");

describe("RAG eval (data/evals/rag.json)", () => {
  it("keeps recall@k at or above the set's minimum on the local index", async () => {
    const set = await loadEvalSet(path.join(root, "data", "evals", "rag.json"));
    const content = await new MarkdownContentSource(path.join(root, "content")).load();
    const report = await new EvaluateRetrieval(new Bm25Retriever(chunkContent(content))).run(set);

    const misses = report.cases
      .filter((c) => c.rank === null)
      .map((c) => `${c.question} → ${c.retrieved.join(", ") || "nada"} (esperava ${c.expected.join(" ou ")})`);
    expect(report.recall, `recall@${set.k} ${report.recall}; erros:\n${misses.join("\n")}`).toBeGreaterThanOrEqual(
      set.minRecall,
    );
  });

  it("only expects sources the content actually has", async () => {
    const set = await loadEvalSet(path.join(root, "data", "evals", "rag.json"));
    const content = await new MarkdownContentSource(path.join(root, "content")).load();
    const sources = chunkContent(content).map((c) => c.source);
    const unknown = set.cases.flatMap((c) => c.expected).filter((e) => !sources.some((s) => matchesExpected(s, e)));
    expect(unknown).toEqual([]);
  });
});

describe("loadEvalSet", () => {
  it("rejects a malformed set", async () => {
    await expect(loadEvalSet(path.join(root, "package.json"))).rejects.toThrow();
  });
});
