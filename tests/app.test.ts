import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { ReportStatus } from "../src/application/report-status.js";
import { SendContact } from "../src/application/send-contact.js";
import type { Answerer } from "../src/domain/answer.js";
import type { Content } from "../src/domain/content.js";
import type { LogFields, Logger } from "../src/domain/logger.js";
import { createApp } from "../src/http/app.js";
import { MarkdownContentSource } from "../src/infrastructure/content/markdown-content-source.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";
import { Bm25Retriever, tokenize } from "../src/infrastructure/search/bm25-retriever.js";
import { chunkContent } from "../src/infrastructure/search/chunker.js";

const root = path.resolve(import.meta.dirname, "..");
let content: Content;

beforeAll(async () => {
  content = await new MarkdownContentSource(path.join(root, "content")).load();
});

describe("search", () => {
  it("folds accents and drops stopwords", () => {
    expect(tokenize("Decisões técnicas do Node.js")).toEqual(["decisoes", "tecnicas", "node.js"]);
  });

  it("splits markdown on headings so a chunk never spans two sections", () => {
    const chunks = chunkContent(content);
    expect(chunks.some((c) => c.source === "docsage.md › Decisões técnicas")).toBe(true);
    expect(chunks.every((c) => !c.text.includes("\n## "))).toBe(true);
  });

  it("ranks the project that matches the question first", () => {
    const retriever = new Bm25Retriever(chunkContent(content));
    const [top] = retriever.search("como funciona o RAG com BM25?");
    expect(top.chunk.source).toMatch(/^docsage\.md/);
    expect(top.matchedTerms).toContain("bm25");
  });

  it("matches every section of a project by its name", () => {
    const retriever = new Bm25Retriever(chunkContent(content));
    const sources = retriever.search("como funciona o docsage?").map((h) => h.chunk.source);
    // Other documents may mention docsage too; its own sections must still lead.
    expect(sources[0]).toMatch(/^docsage\.md/);
    expect(sources.filter((s) => s.startsWith("docsage.md")).length).toBeGreaterThan(1);
  });

  it("shows the query as the index sees it: folded, without stopwords, deduplicated", () => {
    const retriever = new Bm25Retriever(chunkContent(content));
    expect(retriever.terms("Como funciona a Busca? busca BM25")).toEqual(["funciona", "busca", "bm25"]);
  });

  it("returns nothing for unrelated questions", () => {
    const retriever = new Bm25Retriever(chunkContent(content));
    expect(retriever.search("receita de bolo de cenoura")).toEqual([]);
  });
});

describe("http api", () => {
  let server: Server;
  let base: string;
  const fakeAnswerer: Answerer = {
    model: "fake-model",
    answer: async (_q, passages) => ({
      text: `resposta [${passages[0].chunk.source}]`,
      inputTokens: 10,
      outputTokens: 5,
    }),
  };

  const logs: (LogFields & { msg: string })[] = [];
  const logger: Logger = {
    info: (msg, fields) => logs.push({ ...fields, msg }),
    error: (msg, fields) => logs.push({ ...fields, msg }),
  };

  beforeAll(async () => {
    const metrics = new InMemoryMetrics();
    const history = new SampledHistory(metrics);
    history.sample();
    const app = createApp({
      browse: new BrowsePortfolio(content),
      askQuestion: new AskQuestion(new Bm25Retriever(chunkContent(content)), fakeAnswerer),
      reportStatus: new ReportStatus(metrics, fakeAnswerer.model, history),
      sendContact: new SendContact(null),
      inspectVisitor: new InspectVisitor([], { lookup: async () => null }),
      metrics,
      logger,
      publicDir: path.join(root, "public"),
      askLimit: { capacity: 3, refillPerMinute: 1 },
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const ask = (question: unknown) =>
    fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });

  it("lists projects without their bodies and filters by tag", async () => {
    const all = await (await fetch(`${base}/api/projects`)).json();
    expect(all.map((p: { slug: string }) => p.slug)).toEqual(["docsage", "clawd-tracker", "devdek"]);
    expect(all[0]).not.toHaveProperty("body");

    const ia = await (await fetch(`${base}/api/projects?tag=rag`)).json();
    expect(ia).toHaveLength(1);
  });

  it("serves the skills with their evidence", async () => {
    const groups = await (await fetch(`${base}/api/skills`)).json();
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      for (const skill of group.items) expect(skill.evidence.length).toBeGreaterThan(0);
    }
  });

  it("404s on an unknown project", async () => {
    const res = await fetch(`${base}/api/projects/nope`);
    expect(res.status).toBe(404);
  });

  it("answers with the retrieved passages and usage", async () => {
    const res = await ask("o que o docsage faz?");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.answer).toMatch(/^resposta \[docsage\.md/);
    expect(body.passages.length).toBeGreaterThan(0);
    expect(body.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("rejects invalid questions", async () => {
    expect((await ask("")).status).toBe(400);
    expect((await ask("x".repeat(501))).status).toBe(400);
  });

  it("reports the visitor's quota without spending it", async () => {
    const quota = async () => (await fetch(`${base}/api/ask/quota`)).json();
    const before = await quota();
    expect(before).toMatchObject({ limit: 3, refillPerMinute: 1 });
    expect((await quota()).remaining).toBe(before.remaining);
  });

  it("rate limits /api/ask per client", async () => {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await ask("docsage?")).status);
    expect(statuses).toContain(429);
  });

  it("reports per-route metrics in json and prometheus format", async () => {
    const status = await (await fetch(`${base}/api/status`)).json();
    expect(status.llm).toBe("fake-model");
    expect(status.routes.some((r: { route: string }) => r.route === "GET /api/projects/:slug")).toBe(true);

    const metrics = await (await fetch(`${base}/metrics`)).text();
    expect(metrics).toMatch(/portfolio_requests_total\{route="POST \/api\/ask"\} \d+/);
  });

  it("serves the page and falls back to it on unknown paths", async () => {
    expect((await fetch(`${base}/`)).headers.get("content-type")).toMatch(/html/);
    expect((await fetch(`${base}/qualquer-coisa`)).status).toBe(404);
  });

  it("gives every response an x-request-id and logs one line per request", async () => {
    const res = await fetch(`${base}/api/projects/docsage`);
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await new Promise((resolve) => setImmediate(resolve));
    expect(logs.find((l) => l.requestId === id)).toMatchObject({
      msg: "request",
      route: "GET /api/projects/:slug",
      status: 200,
      ms: expect.any(Number),
    });
  });

  it("keeps a safe incoming x-request-id and replaces an unsafe one", async () => {
    const kept = await fetch(`${base}/api/profile`, { headers: { "x-request-id": "traefik-abc.123" } });
    expect(kept.headers.get("x-request-id")).toBe("traefik-abc.123");

    const replaced = await fetch(`${base}/api/profile`, { headers: { "x-request-id": "<script>" } });
    expect(replaced.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not log health probes", async () => {
    const res = await fetch(`${base}/healthz`);
    await new Promise((resolve) => setImmediate(resolve));
    expect(logs.some((l) => l.requestId === res.headers.get("x-request-id"))).toBe(false);
  });

  it("serves the sampled metrics history for the sparklines", async () => {
    const body = await (await fetch(`${base}/api/status/history`)).json();
    expect(body.intervalSeconds).toBe(300);
    expect(body.points[0]).toEqual({
      t: expect.any(Number),
      requestsLastMinute: expect.any(Number),
      rssMb: expect.any(Number),
    });
  });
});
