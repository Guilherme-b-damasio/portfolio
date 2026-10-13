import type { Hit } from "./search.js";

export interface Generation {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** Turns a question plus retrieved passages into a written answer. */
export interface Answerer {
  readonly model: string;
  answer(question: string, passages: Hit[]): Promise<Generation>;
}

export interface AskResult {
  answer: string | null; // null when no LLM is configured: the passages are the answer
  passages: Hit[];
  model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  latencyMs: { retrieval: number; generation: number | null };
  degraded: "token-budget" | null; // why an LLM that is on did not answer, so the terminal can say it
}
