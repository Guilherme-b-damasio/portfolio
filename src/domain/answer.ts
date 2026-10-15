import type { Hit } from "./search.js";

export interface Generation {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** One earlier question and its answer. The visitor's browser keeps them; the server keeps nothing. */
export interface Turn {
  question: string;
  answer: string;
}

export interface AnswerOptions {
  onText?: (delta: string) => void; // called with each piece of the answer as it is written
  signal?: AbortSignal; // aborts generation, e.g. when the visitor closes the stream
  history?: Turn[]; // earlier turns of the conversation, oldest first
}

/** Exactly what the LLM is sent, so the x-ray can show it. */
export interface Prompt {
  system: string;
  history: Turn[];
  user: string;
}

/** Turns a question plus retrieved passages into a written answer. */
export interface Answerer {
  readonly model: string;
  answer(question: string, passages: Hit[], options?: AnswerOptions): Promise<Generation>;
  prompt?(question: string, passages: Hit[], history?: Turn[]): Prompt;
}

export interface AskResult {
  answer: string | null; // null when no LLM is configured: the passages are the answer
  passages: Hit[];
  model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  latencyMs: { retrieval: number; generation: number | null };
  degraded: "token-budget" | null; // why an LLM that is on did not answer, so the terminal can say it
  xray?: AskXray; // only when the visitor asked to see the steps
}

/** Every step of an answer, for `ask --xray`: what the index saw, how it ranked, what the LLM got and what it cost. */
export interface AskXray {
  terms: string[] | null; // null when the retriever cannot say how it reads the query
  ranking: { source: string; score: number; matchedTerms: string[]; kept: boolean }[]; // kept = sent to the LLM
  prompt: Prompt | null; // null without an LLM
  generation: {
    firstTokenMs: number | null; // from the request to the first written word, thinking included
    tokensPerSecond: number;
    costUsd: number | null; // null when the model has no known price
  } | null; // null when nothing was generated
}
