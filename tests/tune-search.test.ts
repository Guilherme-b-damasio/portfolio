import { describe, expect, it } from "vitest";
import { TuneSearch } from "../src/application/tune-search.js";
import type { ExplainedHit, RankingParams, TunableRanker } from "../src/domain/search.js";

const hit = (id: string, score: number, text = "texto"): ExplainedHit => ({
  chunk: { id, source: `${id}.md › Seção`, text },
  score,
  matchedTerms: ["x"],
  length: 10,
  terms: [{ term: "x", tf: 1, df: 1, idf: 1, score }],
});

// Ranks a, b, c under the defaults and reverses them as soon as b moves away from 0.75.
class FakeRanker implements TunableRanker {
  readonly defaults = { k1: 1.5, b: 0.75, k: 4 };
  readonly averageLength = 12.5;
  readonly size = 3;
  calls: RankingParams[] = [];
  rank(_query: string, params: RankingParams) {
    this.calls.push(params);
    const hits = [hit("a", 3), hit("b", 2), hit("c", 1)];
    return (params.b === 0.75 ? hits : hits.reverse()).slice(0, params.k);
  }
  terms(query: string) {
    return query.split(" ");
  }
}

describe("TuneSearch", () => {
  it("ranks with the visitor's parameters and says where each hit sits under the defaults", () => {
    const ranker = new FakeRanker();
    const result = new TuneSearch(ranker).run("busca local", { k1: 1, b: 0, k: 2 });
    expect(result.hits.map((h) => [h.id, h.rank, h.defaultRank])).toEqual([
      ["c", 1, null], // out of the default top 2
      ["b", 2, 2],
    ]);
    expect(ranker.calls).toEqual([
      { k1: 1.5, b: 0.75, k: 2 }, // the baseline keeps the visitor's k
      { k1: 1, b: 0, k: 2 },
    ]);
    expect(result).toMatchObject({
      query: "busca local",
      terms: ["busca", "local"],
      params: { k1: 1, b: 0, k: 2 },
      defaults: { k1: 1.5, b: 0.75, k: 4 },
      index: { chunks: 3, averageLength: 12.5 },
    });
  });

  it("keeps the explanation and a short one-line preview of each chunk", () => {
    const ranker = new FakeRanker();
    ranker.rank = () => [hit("a", 1, `linha um\n\n${"palavra ".repeat(40)}`)];
    const [only] = new TuneSearch(ranker).run("x", ranker.defaults).hits;
    expect(only.preview).not.toContain("\n");
    expect(only.preview.length).toBe(140);
    expect(only.preview.endsWith("…")).toBe(true);
    expect(only.terms).toEqual([{ term: "x", tf: 1, df: 1, idf: 1, score: 1 }]);
    expect(only.source).toBe("a.md › Seção");
  });
});
