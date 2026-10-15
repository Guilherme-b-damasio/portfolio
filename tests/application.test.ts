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

  it("reports the passages first, then each piece of the answer, and hands the signal to the LLM", async () => {
    const events: string[] = [];
    let received: AbortSignal | undefined;
    const answerer: Answerer = {
      model: "fake",
      answer: async (_q, _p, { onText, signal } = {}) => {
        received = signal;
        events.push("generating");
        onText?.("a");
        onText?.("b");
        return { text: "ab", inputTokens: 1, outputTokens: 2 };
      },
    };
    const signal = new AbortController().signal;
    const result = await new AskQuestion(fixedRetriever([hit]), answerer).execute("pergunta", {
      onPassages: (passages, ms) => events.push(`passages:${passages.length}:${ms >= 0}`),
      onText: (d) => events.push(`text:${d}`),
      signal,
    });
    expect(events).toEqual(["passages:1:true", "generating", "text:a", "text:b"]);
    expect(received).toBe(signal);
    expect(result.answer).toBe("ab");
  });

  it("still reports the passages when there is no LLM to stream from", async () => {
    const seen: Hit[][] = [];
    await new AskQuestion(fixedRetriever([hit]), null).execute("pergunta", { onPassages: (p) => seen.push(p) });
    expect(seen).toEqual([[hit]]);
  });
});

describe("AskQuestion --xray", () => {
  const hits = (n: number): Hit[] =>
    Array.from({ length: n }, (_, i) => ({ ...hit, chunk: { ...hit.chunk, source: `s${i}` }, score: 10 - i }));
  const prompting: Answerer = {
    ...echoAnswerer,
    prompt: (q, p) => ({ system: "sys", history: [], user: `${p.length}:${q}` }),
  };
  const prices = { priceOf: (m: string) => (m === "fake" ? { inputPerMTok: 4, outputPerMTok: 20 } : null) };

  it("ranks more candidates than it keeps and marks which ones reached the LLM", async () => {
    const retriever = { ...fixedRetriever(hits(6)), terms: (q: string) => q.split(" ") };
    const result = await new AskQuestion(retriever, prompting, { topK: 2, xrayCandidates: 5, prices }).execute(
      "como funciona",
      { xray: true },
    );

    expect(retriever.calls).toEqual([["como funciona", 5]]);
    expect(result.passages).toHaveLength(2);
    expect(result.xray!.terms).toEqual(["como", "funciona"]);
    expect(result.xray!.ranking.map((r) => r.kept)).toEqual([true, true, false, false, false, false]);
    expect(result.xray!.prompt).toEqual({ system: "sys", history: [], user: "2:como funciona" });
  });

  it("times the generation and prices it", async () => {
    const result = await new AskQuestion(fixedRetriever([hit]), prompting, { prices }).execute("p", { xray: true });
    const generation = result.xray!.generation!;
    // 7 in at $4/M + 3 out at $20/M
    expect(generation.costUsd).toBeCloseTo(0.000088, 10);
    expect(generation.tokensPerSecond).toBeGreaterThan(0);
    expect(generation.firstTokenMs).toBeNull(); // the echo answerer never streams
  });

  it("records when the first word came out", async () => {
    const streaming: Answerer = {
      model: "other",
      answer: async (_q, _p, { onText } = {}) => (onText?.("x"), { text: "x", inputTokens: 1, outputTokens: 1 }),
    };
    const result = await new AskQuestion(fixedRetriever([hit]), streaming, { prices }).execute("p", { xray: true });
    expect(result.xray!.generation!.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(result.xray!.generation!.costUsd).toBeNull(); // no price for "other"
  });

  it("still explains retrieval when nothing is generated, and stays out of plain answers", async () => {
    const off = await new AskQuestion(fixedRetriever([hit]), null).execute("p", { xray: true });
    expect(off.xray).toEqual({
      terms: null,
      ranking: [{ source: "a.md › Intro", score: 1.2, matchedTerms: ["texto"], kept: true }],
      prompt: null,
      generation: null,
    });
    expect(await new AskQuestion(fixedRetriever([hit]), echoAnswerer).execute("p")).not.toHaveProperty("xray");
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
