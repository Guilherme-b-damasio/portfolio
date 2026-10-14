import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { ReportStatus } from "../src/application/report-status.js";
import { SendContact } from "../src/application/send-contact.js";
import type { Answerer } from "../src/domain/answer.js";
import type { Content } from "../src/domain/content.js";
import type { Hit } from "../src/domain/search.js";
import { createApp } from "../src/http/app.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";

const root = path.resolve(import.meta.dirname, "..");
const hit: Hit = { chunk: { id: "a.md#1", source: "a.md › Intro", text: "texto" }, score: 1, matchedTerms: [] };
const content: Content = {
  profile: { name: "N", handle: "n", role: "r", links: {}, body: "" },
  projects: [],
  skills: [],
};

let server: Server | null = null;
afterEach(() => server?.close());

async function start(answerer: Answerer, askTimeoutMs?: number) {
  const metrics = new InMemoryMetrics();
  const app = createApp({
    browse: new BrowsePortfolio(content),
    askQuestion: new AskQuestion({ search: () => [hit] }, answerer),
    reportStatus: new ReportStatus(metrics, answerer.model, new SampledHistory(metrics)),
    sendContact: new SendContact(null),
    inspectVisitor: new InspectVisitor([], { lookup: async () => null }),
    metrics,
    logger: { info: () => {}, error: () => {} },
    publicDir: path.join(root, "public"),
    askTimeoutMs,
  });
  server = app.listen(0);
  await new Promise((resolve) => server!.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const askStream = (base: string) =>
  fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ question: "o que é?" }),
  });

/** Splits an SSE body into its events, in order. */
function events(body: string) {
  return body
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)![1];
      const data = JSON.parse(/^data: (.*)$/m.exec(block)![1]);
      return { event, data };
    });
}

const streaming: Answerer = {
  model: "fake",
  answer: async (_q, _p, { onText } = {}) => {
    for (const d of ["Isso ", "é ", "[a.md › Intro]"]) onText?.(d);
    return { text: "Isso é [a.md › Intro]", inputTokens: 3, outputTokens: 3 };
  },
};

describe("POST /api/ask as an event stream", () => {
  it("sends the passages, then each piece of the answer, then the full result", async () => {
    const res = await askStream(await start(streaming));
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(res.headers.get("cache-control")).toContain("no-cache");
    const sent = events(await res.text());

    expect(sent.map((e) => e.event)).toEqual(["passages", "text", "text", "text", "done"]);
    expect(sent[0].data.passages).toEqual([hit]);
    expect(
      sent
        .slice(1, 4)
        .map((e) => e.data.delta)
        .join(""),
    ).toBe("Isso é [a.md › Intro]");
    expect(sent[4].data).toMatchObject({ answer: "Isso é [a.md › Intro]", usage: { inputTokens: 3 } });
  });

  it("keeps answering in plain JSON when the client does not ask for a stream", async () => {
    const base = await start(streaming);
    const res = await fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "o que é?" }),
    });
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect((await res.json()).answer).toBe("Isso é [a.md › Intro]");
  });

  it("ends with an error event when generation fails after the stream opened", async () => {
    const failing: Answerer = {
      model: "fake",
      answer: async (_q, _p, { onText } = {}) => {
        onText?.("meia ");
        throw new Error("upstream 529");
      },
    };
    const res = await askStream(await start(failing));
    expect(res.status).toBe(200);
    const sent = events(await res.text());
    expect(sent.map((e) => e.event)).toEqual(["passages", "text", "error"]);
    expect(sent[2].data.error).not.toContain("529");
  });

  it("aborts a generation that runs past the timeout", async () => {
    let aborted = false;
    const hanging: Answerer = {
      model: "fake",
      answer: (_q, _p, { signal } = {}) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    };
    const sent = events(await (await askStream(await start(hanging, 50))).text());
    expect(aborted).toBe(true);
    expect(sent.at(-1)!.event).toBe("error");
  });
});
