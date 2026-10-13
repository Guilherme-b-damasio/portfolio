import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { ReportStatus } from "../src/application/report-status.js";
import { SendContact } from "../src/application/send-contact.js";
import type { Answerer } from "../src/domain/answer.js";
import type { Content } from "../src/domain/content.js";
import { createApp } from "../src/http/app.js";
import { MarkdownContentSource } from "../src/infrastructure/content/markdown-content-source.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";
import { Bm25Retriever } from "../src/infrastructure/search/bm25-retriever.js";
import { chunkContent } from "../src/infrastructure/search/chunker.js";

const root = path.resolve(import.meta.dirname, "..");
const fakeAnswerer: Answerer = {
  model: "fake-model",
  answer: async () => ({ text: "resposta [docsage.md › O que é]", inputTokens: 1, outputTokens: 1 }),
};

describe("MCP server at /mcp", () => {
  let server: Server;
  let base: string;
  let client: Client;

  beforeAll(async () => {
    const content: Content = await new MarkdownContentSource(path.join(root, "content")).load();
    const metrics = new InMemoryMetrics();
    const app = createApp({
      browse: new BrowsePortfolio(content),
      askQuestion: new AskQuestion(new Bm25Retriever(chunkContent(content)), fakeAnswerer),
      reportStatus: new ReportStatus(metrics, fakeAnswerer.model, new SampledHistory(metrics)),
      sendContact: new SendContact(null),
      metrics,
      logger: { info: () => {}, error: () => {} },
      publicDir: path.join(root, "public"),
      askLimit: { capacity: 2, refillPerMinute: 1 },
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  });
  afterAll(async () => {
    await client.close();
    server.close();
  });

  it("lists the four read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["ask", "get_project", "get_status", "list_projects"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });

  it("returns projects and a project's full text", async () => {
    const list = await client.callTool({ name: "list_projects", arguments: {} });
    const { projects } = list.structuredContent as { projects: { slug: string }[] };
    expect(projects.map((p) => p.slug)).toContain("docsage");

    const one = await client.callTool({ name: "get_project", arguments: { slug: "docsage" } });
    expect((one.structuredContent as { body: string }).body).toMatch(/## O que é/);

    const missing = await client.callTool({ name: "get_project", arguments: { slug: "nope" } });
    expect(missing.isError).toBe(true);
  });

  it("answers through the same RAG and spends the same question bucket", async () => {
    const first = await client.callTool({ name: "ask", arguments: { question: "como funciona o docsage?" } });
    expect((first.structuredContent as { answer: string }).answer).toMatch(/docsage/);
    await client.callTool({ name: "ask", arguments: { question: "docsage?" } });
    const limited = await client.callTool({ name: "ask", arguments: { question: "docsage?" } });
    expect(limited.isError).toBe(true);
    // The HTTP route sees the empty bucket too.
    const http = await fetch(`${base}/api/ask/quota`);
    expect((await http.json()).remaining).toBe(0);
  });

  it("reports status without the per-route table", async () => {
    const status = await client.callTool({ name: "get_status", arguments: {} });
    expect(status.structuredContent).toMatchObject({ llm: "fake-model" });
    expect(status.structuredContent).not.toHaveProperty("routes");
  });

  it("answers a raw tools/call from the browser playground without initialize", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "list_projects", arguments: {} },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(7);
    expect(body.result.structuredContent.projects.length).toBeGreaterThan(0);
  });

  it("refuses GET, since there is no session stream", async () => {
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });
});
