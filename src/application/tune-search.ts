import type { RankingParams, TermScore, TunableRanker } from "../domain/search.js";

/** How far the playground's sliders go. Past these BM25 stops being interesting, and k caps the response. */
export const TUNING_LIMITS = {
  k1: { min: 0, max: 3 },
  b: { min: 0, max: 1 },
  k: { min: 1, max: 10 },
} as const;

export interface TunedHit {
  id: string;
  source: string;
  preview: string;
  score: number;
  rank: number; // 1-based, under the visitor's parameters
  defaultRank: number | null; // under the server's own; null when the defaults leave it out of the top k
  length: number;
  terms: TermScore[];
}

export interface TunedSearch {
  query: string;
  terms: string[]; // the query as the index sees it
  params: RankingParams;
  defaults: RankingParams;
  index: { chunks: number; averageLength: number };
  hits: TunedHit[];
}

const PREVIEW = 140;

/**
 * The search playground: the same BM25 index the chat uses, ranked with the visitor's k1, b and top-k,
 * side by side with the ranking the server actually answers with.
 */
export class TuneSearch {
  constructor(private readonly ranker: TunableRanker) {}

  get defaults(): RankingParams {
    return this.ranker.defaults;
  }

  run(query: string, params: RankingParams): TunedSearch {
    const defaults = this.ranker.defaults;
    const baseline = this.ranker.rank(query, { ...defaults, k: params.k }).map((h) => h.chunk.id);
    const hits = this.ranker.rank(query, params).map((hit, i) => ({
      id: hit.chunk.id,
      source: hit.chunk.source,
      preview: preview(hit.chunk.text),
      score: hit.score,
      rank: i + 1,
      defaultRank: baseline.includes(hit.chunk.id) ? baseline.indexOf(hit.chunk.id) + 1 : null,
      length: hit.length,
      terms: hit.terms,
    }));
    return {
      query,
      terms: this.ranker.terms(query),
      params,
      defaults,
      index: { chunks: this.ranker.size, averageLength: this.ranker.averageLength },
      hits,
    };
  }
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}…` : flat;
}
