import { describe, expect, it } from "vitest";
import { Bm25Retriever } from "../src/infrastructure/search/bm25-retriever.js";

const exact = (t: string) => t;
// "short" says kubernetes once in 2 words; "long" says it three times among many others.
const chunks = [
  { id: "short", source: "s.md › A", text: "kubernetes" },
  {
    id: "long",
    source: "l.md › B",
    text: "kubernetes kubernetes kubernetes cluster deploy flux helm ingress traefik node pods logs metrics",
  },
  { id: "other", source: "o.md › C", text: "receita bolo cenoura" },
];
const index = new Bm25Retriever(chunks, 1.5, 0.75, exact);
const order = (k1: number, b: number) => index.rank("kubernetes", { k1, b, k: 4 }).map((h) => h.chunk.id);

describe("Bm25Retriever.rank", () => {
  it("ranks exactly like search with the default parameters", () => {
    const ranked = index.rank("kubernetes cluster", { ...index.defaults, k: 2 });
    expect(ranked.map(({ chunk, score, matchedTerms }) => ({ chunk, score, matchedTerms }))).toEqual(
      index.search("kubernetes cluster", 2),
    );
  });

  it("reorders as b turns length normalisation on and off", () => {
    expect(order(1.5, 0)).toEqual(["long", "short"]); // only term frequency counts
    expect(order(1.5, 1)).toEqual(["short", "long"]); // the long chunk pays for its length
  });

  it("ignores repetition when k1 is 0, so every match scores its idf alone", () => {
    const [a, b] = index.rank("kubernetes", { k1: 0, b: 0.75, k: 4 });
    expect(a.score).toBe(b.score);
    expect(a.score).toBe(a.terms[0].idf);
  });

  it("explains each score term by term, and keeps only the top k", () => {
    const [top, ...rest] = index.rank("kubernetes flux", { k1: 1.2, b: 0.5, k: 1 });
    expect(rest).toEqual([]);
    expect(top.chunk.id).toBe("long");
    expect(top.terms.map((t) => [t.term, t.tf, t.df])).toEqual([
      ["kubernetes", 3, 2],
      ["flux", 1, 1],
    ]);
    expect(top.score).toBeCloseTo(top.terms[0].score + top.terms[1].score, 2);
    expect(top.length).toBeGreaterThan(index.averageLength);
    expect(index.size).toBe(3);
  });
});
