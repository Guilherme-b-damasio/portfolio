import type { EvalReport, EvalSet } from "../domain/evaluation.js";
import { type Retriever, RetrieverUnavailable } from "../domain/search.js";
import { EvaluateRetrieval } from "./evaluate-retrieval.js";

export type EvalOutcome = EvalReport | { engine: string; error: string; ranAt: string };

export interface ShowEvalsOptions {
  ttlMs?: number; // a report is reused this long, so visitors never run the eval more than once per window
  now?: () => number;
}

/**
 * The eval as the running server scores it, per engine. Each engine runs at most once per window
 * however many visitors open /evals, and concurrent requests share the run already in flight.
 */
export class ShowEvals {
  private readonly cache = new Map<string, { at: number; outcome: Promise<EvalOutcome> }>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly set: EvalSet,
    private readonly engines: Record<string, Retriever>,
    { ttlMs = 10 * 60_000, now = Date.now }: ShowEvalsOptions = {},
  ) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get engineNames(): string[] {
    return Object.keys(this.engines);
  }

  /** The latest report for an engine, or null when there is no such engine. */
  report(engine: string): Promise<EvalOutcome> | null {
    const retriever = this.engines[engine];
    if (!retriever) return null;
    const cached = this.cache.get(engine);
    if (cached && this.now() - cached.at < this.ttlMs) return cached.outcome;

    const outcome = new EvaluateRetrieval(retriever, engine, () => new Date(this.now()))
      .run(this.set)
      .catch((err: unknown): EvalOutcome => ({
        engine,
        // Only reasons written for visitors are shown; anything else could carry an internal address.
        error: err instanceof RetrieverUnavailable ? err.message : `${engine} falhou`,
        ranAt: new Date(this.now()).toISOString(),
      }));
    this.cache.set(engine, { at: this.now(), outcome });
    return outcome;
  }
}
