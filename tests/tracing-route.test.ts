import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { ReportStatus } from "../src/application/report-status.js";
import { SendContact } from "../src/application/send-contact.js";
import { ShowTrace } from "../src/application/show-trace.js";
import type { Answerer } from "../src/domain/answer.js";
import type { Content } from "../src/domain/content.js";
import type { Hit, Retriever } from "../src/domain/search.js";
import type { SpanAttrs, Trace } from "../src/domain/tracing.js";
import { createApp } from "../src/http/app.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";
import { InMemoryTraces } from "../src/infrastructure/tracing/in-memory-traces.js";

const hit: Hit = { chunk: { id: "a#1", source: "a.md › Sobre", text: "texto" }, score: 1, matchedTerms: ["texto"] };
const retriever: Retriever = { search: () => [hit] };
const answerer: Answerer = {
  model: "fake-model",
  answer: async (_q, _p, options) => {
    options?.onText?.("resposta");
    return { text: "resposta", inputTokens: 7, outputTokens: 3 };
  },
};

describe("AskQuestion spans", () => {
  it("records retrieval and generation as spans with what they did", async () => {
    const spans: { name: string; attrs: SpanAttrs }[] = [];
    const trace: Trace = {
      span: async (name, step, attrs = {}) => {
        const result = await step();
        spans.push({ name, attrs });
        return result;
      },
    };
    await new AskQuestion(retriever, answerer).execute("pergunta", { trace, engine: "docsage" });
    expect(spans).toEqual([
      { name: "retrieve", attrs: { engine: "local", k: 4, hits: 1, fallback: true } },
      {
        name: "generate",
        attrs: { model: "fake-model", inputTokens: 7, outputTokens: 3, firstTokenMs: expect.any(Number) },
      },
    ]);
  });
});

describe("tracing over http", () => {
  let server: Server;
  let base: string;
  const traces = new InMemoryTraces();

  beforeAll(async () => {
    const metrics = new InMemoryMetrics();
    const content: Content = { profile: { name: "n", role: "r", body: "" }, projects: [], skills: [] } as never;
    const app = createApp({
      browse: new BrowsePortfolio(content),
      askQuestion: new AskQuestion(retriever, answerer),
      reportStatus: new ReportStatus(metrics, null, new SampledHistory(metrics)),
      sendContact: new SendContact(null),
      inspectVisitor: new InspectVisitor([], { lookup: async () => null }),
      metrics,
      logger: { info: () => {}, error: () => {} },
      publicDir: path.resolve(import.meta.dirname, "..", "public"),
      traces,
      showTrace: new ShowTrace(traces),
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const ask = (stream: boolean) =>
    fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(stream && { accept: "text/event-stream" }) },
      body: JSON.stringify({ question: "o que é isso?" }),
    });

  // The trace is stored when the response closes, a moment after the client has read it.
  const traceOf = async (id: string) => {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`${base}/api/traces/${id}`);
      if (res.status === 200) return res.json();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`trace ${id} never arrived`);
  };

  it("names the trace of an answer in x-trace-id and serves its spans", async () => {
    for (const stream of [false, true]) {
      const res = await ask(stream);
      await res.text();
      const id = res.headers.get("x-trace-id");
      expect(id).toMatch(/^[0-9a-f]{16}$/);
      const trace = await traceOf(id!);
      expect(trace).toMatchObject({ id, route: "POST /api/ask", status: 200, droppedSpans: 0 });
      expect(trace.spans.map((s: { name: string }) => s.name)).toEqual(["retrieve", "generate"]);
      expect(trace.durationMs).toBeGreaterThanOrEqual(trace.spans[1].startMs);
    }
  });

  it("traces API calls but not static files or trace lookups", async () => {
    expect((await fetch(`${base}/api/status`)).headers.get("x-trace-id")).toMatch(/^[0-9a-f]{16}$/);
    expect((await fetch(`${base}/style.css`)).headers.get("x-trace-id")).toBeNull();
    expect((await fetch(`${base}/api/traces/0000000000000000`)).headers.get("x-trace-id")).toBeNull();
  });

  it("answers 404 for a trace it does not have", async () => {
    const res = await fetch(`${base}/api/traces/nope`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/não encontrado/);
  });
});
