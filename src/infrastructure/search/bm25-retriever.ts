import type { Chunk, ExplainedHit, Hit, RankingParams, Retriever, TunableRanker } from "../../domain/search.js";
import { stemPortuguese } from "./portuguese-stemmer.js";

const STOPWORDS = new Set(
  (
    "a o as os um uma de do da dos das em no na nos nas por para pra com sem que e ou se " +
    "é são foi ser ter tem faz fez fazer fazendo como mais mas eu você ele ela isso esse essa este esta qual quais " +
    "the a an of to in on for with and or is are was be it this that what which how do does you"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export class Bm25Retriever implements Retriever, TunableRanker {
  private readonly docs: { chunk: Chunk; terms: Map<string, number>; length: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  constructor(
    chunks: Chunk[],
    private readonly k1 = 1.5,
    private readonly b = 0.75,
    // Applied to both the index and the query, so "trabalha" finds "trabalho". Pass `(t) => t` to match exact words.
    private readonly stem: (term: string) => string = stemPortuguese,
  ) {
    this.docs = chunks.map((chunk) => {
      // Index the source without ".md" so "docsage" matches every section of docsage.md.
      const tokens = tokenize(`${chunk.source.replace(/\.md\b/g, "")} ${chunk.text}`).map(this.stem);
      const terms = new Map<string, number>();
      for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
      for (const t of terms.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { chunk, terms, length: tokens.length };
    });
    this.avgLength = this.docs.reduce((sum, d) => sum + d.length, 0) / Math.max(this.docs.length, 1);
  }

  terms(query: string): string[] {
    return [...new Set(tokenize(query).map(this.stem))];
  }

  get defaults(): RankingParams {
    return { k1: this.k1, b: this.b, k: 4 };
  }

  get averageLength(): number {
    return Number(this.avgLength.toFixed(1));
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, k = 4): Hit[] {
    return this.rank(query, { k1: this.k1, b: this.b, k }).map(({ chunk, score, matchedTerms }) => ({
      chunk,
      score,
      matchedTerms,
    }));
  }

  /** The same ranking with any k1 and b, and what each query term added to each score. */
  rank(query: string, { k1, b, k }: RankingParams): ExplainedHit[] {
    const queryTerms = this.terms(query);
    const n = this.docs.length;

    return this.docs
      .map(({ chunk, terms, length }) => {
        let score = 0;
        const explained = [];
        for (const term of queryTerms) {
          const tf = terms.get(term);
          if (!tf) continue;
          const df = this.df.get(term) ?? 0;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          const termScore = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (length / this.avgLength))));
          score += termScore;
          explained.push({ term, tf, df, idf: round(idf), score: round(termScore) });
        }
        return { chunk, score: round(score), matchedTerms: explained.map((t) => t.term), length, terms: explained };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

const round = (n: number) => Number(n.toFixed(3));
