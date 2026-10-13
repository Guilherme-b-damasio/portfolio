import type { Answerer, AskResult } from "../domain/answer.js";
import type { Retriever } from "../domain/search.js";
import type { TokenBudget } from "../domain/token-budget.js";

export interface AskOptions {
  topK?: number;
  budget?: TokenBudget | null; // without one, generation is never cut off
}

/**
 * Retrieves passages for a question and, when an LLM is configured, writes an answer from them.
 * Once the token budget is spent it keeps answering with the passages alone.
 */
export class AskQuestion {
  private readonly topK: number;
  private readonly budget: TokenBudget | null;

  constructor(
    private readonly retriever: Retriever,
    private readonly answerer: Answerer | null,
    { topK = 4, budget = null }: AskOptions = {},
  ) {
    this.topK = topK;
    this.budget = budget;
  }

  get model(): string | null {
    return this.answerer?.model ?? null;
  }

  async execute(question: string): Promise<AskResult> {
    const t0 = performance.now();
    const passages = await this.retriever.search(question, this.topK);
    const retrieval = performance.now() - t0;

    const onlyPassages = (degraded: AskResult["degraded"] = null): AskResult => ({
      answer: null,
      passages,
      model: null,
      usage: null,
      latencyMs: { retrieval, generation: null },
      degraded,
    });

    if (!this.answerer || passages.length === 0) return onlyPassages();
    if (this.budget && !this.budget.canSpend()) return onlyPassages("token-budget");

    const t1 = performance.now();
    const { text, inputTokens, outputTokens } = await this.answerer.answer(question, passages);
    this.budget?.charge(inputTokens + outputTokens);
    return {
      answer: text,
      passages,
      model: this.answerer.model,
      usage: { inputTokens, outputTokens },
      latencyMs: { retrieval, generation: performance.now() - t1 },
      degraded: null,
    };
  }
}
