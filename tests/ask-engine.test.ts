import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { ReportStatus } from "../src/application/report-status.js";
import { SendContact } from "../src/application/send-contact.js";
import type { Content } from "../src/domain/content.js";
import type { LogFields } from "../src/domain/logger.js";
import { type Hit, RetrieverUnavailable } from "../src/domain/search.js";
import { createApp } from "../src/http/app.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";

const root = path.resolve(import.meta.dirname, "..");
const hit = (id: string): Hit => ({ chunk: { id, source: "a.md › Intro", text: "texto" }, score: 1, matchedTerms: [] });
const content: Content = {
  profile: { name: "N", handle: "n", role: "r", links: {}, body: "" },
  projects: [],
  skills: [],
};

describe("/api/ask engines", () => {
  let server: Server;
  let base: string;
  let docsageUp = true;
  const logs: (LogFields & { msg: string })[] = [];

  beforeAll(async () => {
    const metrics = new InMemoryMetrics();
    const docsage = {
      search: () => {
        if (!docsageUp) throw new RetrieverUnavailable("docsage está fora do ar");
        return [hit("docsage:1")];
      },
    };
    const app = createApp({
      browse: new BrowsePortfolio(content),
      askQuestion: new AskQuestion({ search: () => [hit("local:1")] }, null, { engines: { docsage } }),
      reportStatus: new ReportStatus(metrics, null, new SampledHistory(metrics)),
      sendContact: new SendContact(null),
      inspectVisitor: new InspectVisitor([], { lookup: async () => null }),
      metrics,
      logger: { info: (msg, fields) => logs.push({ ...fields, msg }), error: () => {} },
      publicDir: path.join(root, "public"),
      askLimit: { capacity: 20, refillPerMinute: 20 },
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const ask = (body: Record<string, unknown>, accept = "application/json") =>
    fetch(`${base}/api/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", accept },
      body: JSON.stringify({ question: "o que é?", ...body }),
    });

  it("lists the engines this server can search with", async () => {
    expect(await (await fetch(`${base}/api/ask/engines`)).json()).toEqual({ engines: ["local", "docsage"] });
  });

  it("searches with the engine in the body", async () => {
    const body = await (await ask({ engine: "docsage" })).json();
    expect(body).toMatchObject({ engine: "docsage", engineFallback: null });
    expect(body.passages[0].chunk.id).toBe("docsage:1");
  });

  it("answers from the local index when the engine is down, says why and logs it", async () => {
    docsageUp = false;
    const body = await (await ask({ engine: "docsage" })).json();
    docsageUp = true;
    expect(body).toMatchObject({ engine: "local", engineFallback: "docsage está fora do ar" });
    expect(logs.find((l) => l.msg.startsWith("ask fell back"))).toMatchObject({
      msg: "ask fell back to the local index",
      reason: "docsage está fora do ar",
    });
  });

  it("carries the engine through the stream as well", async () => {
    const text = await (await ask({ engine: "docsage" }, "text/event-stream")).text();
    expect(text).toContain('"engine":"docsage"');
  });

  it("rejects an engine name that is not a plain word", async () => {
    expect((await ask({ engine: "../etc" })).status).toBe(400);
    expect((await ask({ engine: "x".repeat(21) })).status).toBe(400);
  });
});
