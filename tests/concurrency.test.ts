import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { ReportStatus } from "../src/application/report-status.js";
import { SendContact } from "../src/application/send-contact.js";
import type { Answerer } from "../src/domain/answer.js";
import { createApp } from "../src/http/app.js";
import { ConcurrencyGate } from "../src/http/middleware/concurrency.js";
import { MarkdownContentSource } from "../src/infrastructure/content/markdown-content-source.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";
import { Bm25Retriever } from "../src/infrastructure/search/bm25-retriever.js";
import { chunkContent } from "../src/infrastructure/search/chunker.js";

const root = path.resolve(import.meta.dirname, "..");

describe("ConcurrencyGate", () => {
  it("hands out slots up to the limit and refuses the rest", () => {
    const gate = new ConcurrencyGate(2);
    const a = gate.tryAcquire();
    const b = gate.tryAcquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
    expect(gate.inFlight).toBe(2);
  });

  it("frees a slot on release, and releasing twice frees only one", () => {
    const gate = new ConcurrencyGate(1);
    const release = gate.tryAcquire()!;
    release();
    release();
    expect(gate.inFlight).toBe(0);
    expect(gate.tryAcquire()).not.toBeNull();
    expect(gate.tryAcquire()).toBeNull();
  });
});

describe("POST /api/ask under load", () => {
  let server: Server;
  let base: string;
  let finish: () => void = () => {};
  let started: Promise<void>;
  let markStarted: () => void = () => {};
  const expectGeneration = () => {
    started = new Promise((resolve) => (markStarted = resolve));
  };

  beforeAll(async () => {
    // Holds every generation open until the test lets it go, so requests overlap for real.
    const slowAnswerer: Answerer = {
      model: "fake-model",
      answer: () =>
        new Promise((resolve) => {
          finish = () => resolve({ text: "ok", inputTokens: 1, outputTokens: 1 });
          markStarted();
        }),
    };
    const content = await new MarkdownContentSource(path.join(root, "content")).load();
    const metrics = new InMemoryMetrics();
    const app = createApp({
      browse: new BrowsePortfolio(content),
      askQuestion: new AskQuestion(new Bm25Retriever(chunkContent(content)), slowAnswerer),
      reportStatus: new ReportStatus(metrics, "fake-model", new SampledHistory(metrics)),
      sendContact: new SendContact(null),
      metrics,
      logger: { info: () => {}, error: () => {} },
      publicDir: path.join(root, "public"),
      askLimit: { capacity: 10, refillPerMinute: 10 },
      askConcurrency: 1,
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const ask = () =>
    fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "o que o docsage faz?" }),
    });
  const quota = async () => (await (await fetch(`${base}/api/ask/quota`)).json()).remaining;

  it("turns away the request over the cap with 503 and Retry-After, without spending its token", async () => {
    expectGeneration();
    const first = ask();
    await started;
    const before = await quota();

    const second = await ask();
    expect(second.status).toBe(503);
    expect(second.headers.get("retry-after")).toBe("5");
    expect(await quota()).toBe(before);

    finish();
    expect((await first).status).toBe(200);
  });

  it("frees the slot once the answer is sent", async () => {
    expectGeneration();
    const next = ask();
    await started;
    finish();
    expect((await next).status).toBe(200);
  });
});
