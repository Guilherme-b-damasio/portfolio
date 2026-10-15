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
