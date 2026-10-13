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
}
