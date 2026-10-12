import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { ClaudeAnswerer } from "./ask.js";
import { loadContent } from "./content.js";
import { Bm25Retriever, chunkContent } from "./search.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 3000);

const content = await loadContent(process.env.CONTENT_DIR ?? path.join(root, "content"));
const retriever = new Bm25Retriever(chunkContent(content));
// Without a key the chat still works: it returns the retrieved passages instead of a generated answer.
const answerer = process.env.ANTHROPIC_API_KEY ? new ClaudeAnswerer() : null;

const app = createApp({ content, retriever, answerer, publicDir: path.join(root, "public") });

const server = app.listen(port, () => {
  console.log(
    JSON.stringify({ level: "info", msg: "listening", port, projects: content.projects.length, llm: answerer?.model ?? "off" }),
  );
});

// k8s sends SIGTERM on rollout; finish in-flight requests before exiting.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
