import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { ReportStatus } from "../src/application/report-status.js";
import { SendContact } from "../src/application/send-contact.js";
import { ShowEvals } from "../src/application/show-evals.js";
import type { Content } from "../src/domain/content.js";
import { RetrieverUnavailable } from "../src/domain/search.js";
import { createApp } from "../src/http/app.js";
import { MarkdownContentSource } from "../src/infrastructure/content/markdown-content-source.js";
import { loadEvalSet } from "../src/infrastructure/evals/json-eval-set.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";
import { Bm25Retriever } from "../src/infrastructure/search/bm25-retriever.js";
import { chunkContent } from "../src/infrastructure/search/chunker.js";

const root = path.resolve(import.meta.dirname, "..");

describe("/api/evals", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const content: Content = await new MarkdownContentSource(path.join(root, "content")).load();
    const retriever = new Bm25Retriever(chunkContent(content));
    const docsage = {
      search: () => {
        throw new RetrieverUnavailable("docsage está fora do ar");
      },
    };
    const metrics = new InMemoryMetrics();
    const app = createApp({
      browse: new BrowsePortfolio(content),
      askQuestion: new AskQuestion(retriever, null),
      reportStatus: new ReportStatus(metrics, null, new SampledHistory(metrics)),
      sendContact: new SendContact(null),
      inspectVisitor: new InspectVisitor([], { lookup: async () => null }),
      metrics,
      logger: { info: () => {}, error: () => {} },
      publicDir: path.join(root, "public"),
      showEvals: new ShowEvals(await loadEvalSet(path.join(root, "data", "evals", "rag.json")), {
        local: retriever,
        docsage,
      }),
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("scores the real index with the shipped questions", async () => {
    const res = await fetch(`${base}/api/evals`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.engines).toEqual(["local", "docsage"]);
    expect(body.report).toMatchObject({ engine: "local", k: 3, passed: true });
    expect(body.report.cases.length).toBeGreaterThanOrEqual(20);
  });

  it("reports an engine that is down instead of failing the request", async () => {
    const body = await (await fetch(`${base}/api/evals?engine=docsage`)).json();
    expect(body.report).toMatchObject({ engine: "docsage", error: "docsage está fora do ar" });
  });

  it("404s on an unknown engine", async () => {
    const res = await fetch(`${base}/api/evals?engine=nope`);
    expect(res.status).toBe(404);
    expect((await res.json()).engines).toEqual(["local", "docsage"]);
  });
});
