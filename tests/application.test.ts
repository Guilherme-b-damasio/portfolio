import { describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { ReportStatus } from "../src/application/report-status.js";
import type { Answerer } from "../src/domain/answer.js";
import type { Content } from "../src/domain/content.js";
import type { MetricsSnapshot, MetricsStore } from "../src/domain/metrics.js";
import type { Hit, Retriever } from "../src/domain/search.js";

const hit: Hit = { chunk: { id: "a.md#1", source: "a.md › Intro", text: "texto" }, score: 1.2, matchedTerms: ["texto"] };

const fixedRetriever = (hits: Hit[]): Retriever & { calls: [string, number | undefined][] } => {
  const calls: [string, number | undefined][] = [];
  return { calls, search: (q, k) => (calls.push([q, k]), hits) };
};

const echoAnswerer: Answerer = {
  model: "fake",
  answer: async (q, passages) => ({ text: `${q} (${passages.length})`, inputTokens: 7, outputTokens: 3 }),
};

describe("AskQuestion", () => {
  it("asks the retriever for top-k and the answerer for a reply", async () => {
    const retriever = fixedRetriever([hit]);
    const result = await new AskQuestion(retriever, echoAnswerer, 2).execute("pergunta");
    expect(retriever.calls).toEqual([["pergunta", 2]]);
    expect(result.answer).toBe("pergunta (1)");
    expect(result.model).toBe("fake");
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(result.latencyMs.generation).not.toBeNull();
  });

  it("returns only the passages when no LLM is configured", async () => {
    const result = await new AskQuestion(fixedRetriever([hit]), null).execute("pergunta");
    expect(result).toMatchObject({ answer: null, passages: [hit], model: null, usage: null });
  });

  it("skips generation when nothing was retrieved", async () => {
    let called = false;
    const answerer: Answerer = { model: "fake", answer: async () => ((called = true), { text: "", inputTokens: 0, outputTokens: 0 }) };
    const result = await new AskQuestion(fixedRetriever([]), answerer).execute("pergunta");
    expect(called).toBe(false);
    expect(result.answer).toBeNull();
  });
});

describe("BrowsePortfolio", () => {
  const content: Content = {
    profile: { name: "N", handle: "n", role: "dev", links: {}, body: "" },
    projects: [
      { slug: "a", name: "A", summary: "", stack: [], tags: ["ia"], order: 1, body: "corpo" },
      { slug: "b", name: "B", summary: "", stack: [], tags: [], order: 2, body: "corpo" },
    ],
  };
  const browse = new BrowsePortfolio(content);

  it("lists summaries without bodies, filtered by tag", () => {
    expect(browse.projects().map((p) => p.slug)).toEqual(["a", "b"]);
    expect(browse.projects("ia").map((p) => p.slug)).toEqual(["a"]);
    expect(browse.projects()[0]).not.toHaveProperty("body");
  });

  it("finds a project by slug", () => {
    expect(browse.project("b")?.name).toBe("B");
    expect(browse.project("nope")).toBeUndefined();
  });
});

describe("ReportStatus", () => {
  it("adds the active model to the metrics snapshot", () => {
    const snapshot = { uptimeSeconds: 1, routes: [] } as unknown as MetricsSnapshot;
    const metrics: MetricsStore = { record: () => {}, snapshot: () => snapshot, prometheus: () => "x 1\n" };
    const report = new ReportStatus(metrics, null);
    expect(report.status()).toEqual({ ...snapshot, llm: null });
    expect(report.prometheus()).toBe("x 1\n");
  });
});
