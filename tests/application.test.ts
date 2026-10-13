import { describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { ReportStatus } from "../src/application/report-status.js";
import type { Answerer } from "../src/domain/answer.js";
import type { Content } from "../src/domain/content.js";
import type { MetricsHistory, MetricsSnapshot, MetricsStore } from "../src/domain/metrics.js";
import type { Hit, Retriever } from "../src/domain/search.js";
import { DailyTokenBudget } from "../src/infrastructure/llm/daily-token-budget.js";

const hit: Hit = {
  chunk: { id: "a.md#1", source: "a.md › Intro", text: "texto" },
  score: 1.2,
  matchedTerms: ["texto"],
};

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
    const result = await new AskQuestion(retriever, echoAnswerer, { topK: 2 }).execute("pergunta");
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
    const answerer: Answerer = {
      model: "fake",
      answer: async () => ((called = true), { text: "", inputTokens: 0, outputTokens: 0 }),
    };
    const result = await new AskQuestion(fixedRetriever([]), answerer).execute("pergunta");
    expect(called).toBe(false);
    expect(result.answer).toBeNull();
  });

  it("charges every generation to the budget", async () => {
    const budget = new DailyTokenBudget(100);
    await new AskQuestion(fixedRetriever([hit]), echoAnswerer, { budget }).execute("pergunta");
    expect(budget.usage().used).toBe(10);
  });

  it("falls back to the passages and says why once the budget is spent", async () => {
    let called = false;
    const answerer: Answerer = {
      model: "fake",
      answer: async () => ((called = true), { text: "", inputTokens: 0, outputTokens: 0 }),
    };
    const budget = new DailyTokenBudget(10);
    budget.charge(10);
    const result = await new AskQuestion(fixedRetriever([hit]), answerer, { budget }).execute("pergunta");
    expect(called).toBe(false);
    expect(result).toMatchObject({ answer: null, passages: [hit], model: null, degraded: "token-budget" });
  });
});

describe("BrowsePortfolio", () => {
  const content: Content = {
    profile: { name: "N", handle: "n", role: "dev", links: {}, body: "" },
    projects: [
      { slug: "a", name: "A", summary: "", stack: [], tags: ["ia"], order: 1, body: "corpo" },
      { slug: "b", name: "B", summary: "", stack: [], tags: [], order: 2, body: "corpo" },
    ],
    skills: [
      {
        title: "IA",
        items: [{ name: "RAG", evidence: [{ where: "a", text: "t", action: { type: "live", label: "ver" } }] }],
      },
    ],
  };
  const browse = new BrowsePortfolio(content);

  it("lists summaries without bodies, filtered by tag", () => {
    expect(browse.projects().map((p) => p.slug)).toEqual(["a", "b"]);
    expect(browse.projects("ia").map((p) => p.slug)).toEqual(["a"]);
    expect(browse.projects()[0]).not.toHaveProperty("body");
  });

  it("exposes the skill groups as loaded", () => {
    expect(browse.skills()[0].items[0].name).toBe("RAG");
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
    const history: MetricsHistory = { intervalMs: 300_000, points: () => [] };
    const report = new ReportStatus(metrics, null, history);
    expect(report.status()).toEqual({ ...snapshot, llm: null, llmBudget: null });
    expect(report.prometheus()).toBe("x 1\n");
  });

  it("reports the history interval in seconds", () => {
    const point = { t: 1, requestsLastMinute: 2, rssMb: 60 };
    const report = new ReportStatus({} as MetricsStore, null, { intervalMs: 300_000, points: () => [point] });
    expect(report.history()).toEqual({ intervalSeconds: 300, points: [point] });
  });

  it("reports the token budget in json and prometheus format", () => {
    const metrics: MetricsStore = {
      record: () => {},
      snapshot: () => ({ routes: [] }) as unknown as MetricsSnapshot,
      prometheus: () => "x 1\n",
    };
    const budget = new DailyTokenBudget(1000, () => Date.UTC(2026, 9, 13, 12));
    budget.charge(250);
    const report = new ReportStatus(metrics, "fake", { intervalMs: 1, points: () => [] }, budget);
    expect(report.status().llmBudget).toMatchObject({ limit: 1000, used: 250, remaining: 750 });
    expect(report.prometheus()).toMatch(/^x 1\n/);
    expect(report.prometheus()).toMatch(/^portfolio_llm_tokens_used_today 250$/m);
    expect(report.prometheus()).toMatch(/^portfolio_llm_tokens_daily_limit 1000$/m);
  });
});
