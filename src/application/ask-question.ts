import type { Answerer, AskResult, AskXray, Turn } from "../domain/answer.js";
import { costUsd, type PriceList } from "../domain/pricing.js";
import { type Hit, type Retriever, RetrieverUnavailable } from "../domain/search.js";
import type { TokenBudget } from "../domain/token-budget.js";

export interface AskOptions {
  topK?: number;
  budget?: TokenBudget | null; // without one, generation is never cut off
  prices?: PriceList | null; // without one, the x-ray shows no cost
  xrayCandidates?: number; // how much of the ranking the x-ray shows, kept or not
  maxTurns?: number; // earlier turns kept from a follow-up; older ones are dropped
  engines?: Record<string, Retriever>; // other retrievers a visitor may pick; the constructor's one is "local"
}

export const LOCAL_ENGINE = "local";

/** Hooks for showing an answer while it is produced (the SSE route); the JSON route passes none. */
export interface AskProgress {
  onPassages?: (passages: Hit[], retrievalMs: number) => void;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
  xray?: boolean; // also report every step of the answer
  history?: Turn[]; // earlier turns, oldest first, when this is a follow-up
  engine?: string; // which retriever to search with; anything unknown or failing falls back to "local"
}

/**
 * Retrieves passages for a question and, when an LLM is configured, writes an answer from them.
 * Once the token budget is spent it keeps answering with the passages alone.
 */
export class AskQuestion {
  private readonly topK: number;
  private readonly budget: TokenBudget | null;
  private readonly prices: PriceList | null;
  private readonly xrayCandidates: number;
  private readonly maxTurns: number;
  private readonly engines: Map<string, Retriever>;

  constructor(
    private readonly retriever: Retriever,
    private readonly answerer: Answerer | null,
    { topK = 4, budget = null, prices = null, xrayCandidates = 8, maxTurns = 3, engines = {} }: AskOptions = {},
  ) {
    this.topK = topK;
    this.budget = budget;
    this.prices = prices;
    this.xrayCandidates = xrayCandidates;
    this.maxTurns = maxTurns;
    this.engines = new Map(Object.entries(engines));
  }

  /** Every engine this server can search with, the local one first. */
  get engineNames(): string[] {
    return [LOCAL_ENGINE, ...this.engines.keys()];
  }

  get model(): string | null {
    return this.answerer?.model ?? null;
  }

  async execute(
    question: string,
    { onPassages, onText, signal, xray = false, history = [], engine = LOCAL_ENGINE }: AskProgress = {},
  ): Promise<AskResult> {
    const turns = this.maxTurns > 0 ? history.slice(-this.maxTurns) : [];
    // "e qual a stack?" names nothing: the previous question supplies the subject for retrieval.
    const query = turns.length ? `${turns[turns.length - 1].question} ${question}` : question;

    const t0 = performance.now();
    // The x-ray also shows the runners-up, so it asks for more than the LLM will get.
    const { ranked, used, fallback } = await this.retrieve(
      engine,
      query,
      xray ? Math.max(this.topK, this.xrayCandidates) : this.topK,
    );
    const passages = ranked.slice(0, this.topK);
    const retrieval = performance.now() - t0;
    onPassages?.(passages, retrieval);

    const steps: AskXray | undefined = xray
      ? {
          terms: (this.engines.get(used) ?? this.retriever).terms?.(query) ?? null,
          ranking: ranked.map((hit, i) => ({
            source: hit.chunk.source,
            score: hit.score,
            matchedTerms: hit.matchedTerms,
            kept: i < this.topK,
          })),
          prompt: this.answerer?.prompt && passages.length ? this.answerer.prompt(question, passages, turns) : null,
          generation: null,
        }
      : undefined;

    const onlyPassages = (degraded: AskResult["degraded"] = null): AskResult => ({
      answer: null,
      passages,
      model: null,
      usage: null,
      latencyMs: { retrieval, generation: null },
      degraded,
      engine: used,
      engineFallback: fallback,
      ...(steps && { xray: steps }),
    });

    if (!this.answerer || passages.length === 0) return onlyPassages();
    if (this.budget && !this.budget.canSpend()) return onlyPassages("token-budget");

    const t1 = performance.now();
    let firstToken: number | null = null;
    const { text, inputTokens, outputTokens } = await this.answerer.answer(question, passages, {
      onText: (delta) => {
        firstToken ??= performance.now() - t1;
        onText?.(delta);
      },
      signal,
      history: turns,
    });
    const generation = performance.now() - t1;
    this.budget?.charge(inputTokens + outputTokens);

    if (steps) {
      const price = this.prices?.priceOf(this.answerer.model) ?? null;
      steps.generation = {
        firstTokenMs: firstToken,
        tokensPerSecond: generation > 0 ? outputTokens / (generation / 1000) : 0,
        costUsd: price ? costUsd(price, inputTokens, outputTokens) : null,
      };
    }
    return {
      answer: text,
      passages,
      model: this.answerer.model,
      usage: { inputTokens, outputTokens },
      latencyMs: { retrieval, generation },
      degraded: null,
      engine: used,
      engineFallback: fallback,
      ...(steps && { xray: steps }),
    };
  }

  /** Searches with the engine asked for; when it is unknown or fails, the local index answers and says why. */
  private async retrieve(
    engine: string,
    query: string,
    k: number,
  ): Promise<{ ranked: Hit[]; used: string; fallback: string | null }> {
    const chosen = this.engines.get(engine);
    if (engine !== LOCAL_ENGINE && chosen) {
      try {
        return { ranked: await chosen.search(query, k), used: engine, fallback: null };
      } catch (err) {
        // Only reasons written for the visitor are shown; anything else could carry an internal address.
        const reason = err instanceof RetrieverUnavailable ? err.message : `${engine} falhou`;
        return { ranked: await this.retriever.search(query, k), used: LOCAL_ENGINE, fallback: reason };
      }
    }
    const fallback = engine === LOCAL_ENGINE ? null : `${engine} não está ligado neste servidor`;
    return { ranked: await this.retriever.search(query, k), used: LOCAL_ENGINE, fallback };
  }
}
