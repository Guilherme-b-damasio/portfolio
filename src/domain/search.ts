export interface Chunk {
  id: string;
  source: string; // e.g. "docsage.md › Decisões técnicas"
  text: string;
}

export interface Hit {
  chunk: Chunk;
  score: number;
  matchedTerms: string[];
}

/** Anything that can turn a question into ranked passages. The local BM25 is the default; docsage can replace it. */
export interface Retriever {
  search(query: string, k?: number): Hit[] | Promise<Hit[]>;
  /** The query as the index sees it, for the x-ray. Retrievers that cannot say leave it out. */
  terms?(query: string): string[];
}

/** A retriever that could not search right now. Its message is written for the visitor, so it names no host. */
export class RetrieverUnavailable extends Error {
  override name = "RetrieverUnavailable";
}

/** BM25's knobs: term saturation (k1), length normalisation (b) and how many hits to keep (k). */
export interface RankingParams {
  k1: number;
  b: number;
  k: number;
}

/** What one query term added to a hit's score, so the playground can show why it ranked where it did. */
export interface TermScore {
  term: string;
  tf: number; // occurrences in the chunk
  df: number; // chunks that contain it
  idf: number;
  score: number;
}

export interface ExplainedHit extends Hit {
  length: number; // the chunk in index terms, against the average
  terms: TermScore[];
}

/** A retriever whose BM25 parameters can be turned per query, explaining each score. */
export interface TunableRanker {
  readonly defaults: RankingParams;
  readonly averageLength: number;
  readonly size: number; // chunks in the index
  rank(query: string, params: RankingParams): ExplainedHit[];
}
