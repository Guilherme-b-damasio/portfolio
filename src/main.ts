import path from "node:path";
import { fileURLToPath } from "node:url";
import { AskQuestion } from "./application/ask-question.js";
import { BrowsePortfolio } from "./application/browse-portfolio.js";
import { ReportStatus } from "./application/report-status.js";
import { createApp } from "./http/app.js";
import { MarkdownContentSource } from "./infrastructure/content/markdown-content-source.js";
import { ClaudeAnswerer } from "./infrastructure/llm/claude-answerer.js";
import { InMemoryMetrics } from "./infrastructure/metrics/in-memory-metrics.js";
import { Bm25Retriever } from "./infrastructure/search/bm25-retriever.js";
import { chunkContent } from "./infrastructure/search/chunker.js";

// The only composition root: every adapter is built here and injected into the use cases.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 3000);

const content = await new MarkdownContentSource(process.env.CONTENT_DIR ?? path.join(root, "content")).load();
const retriever = new Bm25Retriever(chunkContent(content));
// Without a key the chat still works: it returns the retrieved passages instead of a generated answer.
const answerer = process.env.ANTHROPIC_API_KEY ? new ClaudeAnswerer() : null;
const metrics = new InMemoryMetrics();

const app = createApp({
  browse: new BrowsePortfolio(content),
  askQuestion: new AskQuestion(retriever, answerer),
  reportStatus: new ReportStatus(metrics, answerer?.model ?? null),
  metrics,
  publicDir: path.join(root, "public"),
});

const server = app.listen(port, () => {
  console.log(
    JSON.stringify({ level: "info", msg: "listening", port, projects: content.projects.length, llm: answerer?.model ?? "off" }),
  );
});

// k8s sends SIGTERM on rollout; finish in-flight requests before exiting.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
