import type { Answerer, AskResult } from "../domain/answer.js";
import type { Retriever } from "../domain/search.js";

/** Retrieves passages for a question and, when an LLM is configured, writes an answer from them. */
export class AskQuestion {
  constructor(
    private readonly retriever: Retriever,
    private readonly answerer: Answerer | null,
    private readonly topK = 4,
  ) {}

  get model(): string | null {
    return this.answerer?.model ?? null;
  }

  async execute(question: string): Promise<AskResult> {
    const t0 = performance.now();
    const passages = await this.retriever.search(question, this.topK);
    const retrieval = performance.now() - t0;

    if (!this.answerer || passages.length === 0) {
      return { answer: null, passages, model: null, usage: null, latencyMs: { retrieval, generation: null } };
    }

    const t1 = performance.now();
    const { text, inputTokens, outputTokens } = await this.answerer.answer(question, passages);
    return {
      answer: text,
      passages,
      model: this.answerer.model,
      usage: { inputTokens, outputTokens },
      latencyMs: { retrieval, generation: performance.now() - t1 },
    };
  }
}
