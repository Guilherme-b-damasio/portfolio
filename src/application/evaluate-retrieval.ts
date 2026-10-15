import { type EvalReport, type EvalSet, matchesExpected } from "../domain/evaluation.js";
import type { Retriever } from "../domain/search.js";

/**
 * Runs the retrieval eval: every question goes to the retriever, and the report says how many
 * found an expected source in the top k (recall@k) and how high (MRR). No LLM is involved.
 */
export class EvaluateRetrieval {
  constructor(
    private readonly retriever: Retriever,
    private readonly engine = "local",
    private readonly now: () => Date = () => new Date(),
  ) {}

  async run({ k, minRecall, cases }: EvalSet): Promise<EvalReport> {
    const t0 = performance.now();
    const results = [];
    for (const { question, expected } of cases) {
      const retrieved = (await this.retriever.search(question, k)).map((hit) => hit.chunk.source);
      const index = retrieved.findIndex((source) => expected.some((e) => matchesExpected(source, e)));
      results.push({ question, expected, rank: index === -1 ? null : index + 1, retrieved });
    }
    const n = Math.max(results.length, 1);
    const recall = round(results.filter((r) => r.rank !== null).length / n);
    return {
      engine: this.engine,
      k,
      recall,
      mrr: round(results.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / n),
      minRecall,
      passed: recall >= minRecall,
      cases: results,
      ranAt: this.now().toISOString(),
      ms: performance.now() - t0,
    };
  }
}

const round = (x: number) => Number(x.toFixed(3));
