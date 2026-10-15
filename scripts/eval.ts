// `npm run eval`: scores the local index against data/evals/rag.json and prints every question.
// Exits 1 below the set's minRecall, so CI shows the table and fails on a drop.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvaluateRetrieval } from "../src/application/evaluate-retrieval.js";
import { MarkdownContentSource } from "../src/infrastructure/content/markdown-content-source.js";
import { loadEvalSet } from "../src/infrastructure/evals/json-eval-set.js";
import { Bm25Retriever } from "../src/infrastructure/search/bm25-retriever.js";
import { chunkContent } from "../src/infrastructure/search/chunker.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const set = await loadEvalSet(process.argv[2] ?? path.join(root, "data", "evals", "rag.json"));
const content = await new MarkdownContentSource(path.join(root, "content")).load();
const report = await new EvaluateRetrieval(new Bm25Retriever(chunkContent(content))).run(set);

for (const c of report.cases) {
  const mark = c.rank === null ? "MISS" : `#${c.rank}  `;
  console.log(`${mark}  ${c.question}`);
  if (c.rank === null)
    console.log(`        esperava ${c.expected.join(" ou ")}; veio ${c.retrieved.join(", ") || "nada"}`);
}
console.log(
  `\nrecall@${report.k} ${report.recall} (mínimo ${report.minRecall}) · MRR ${report.mrr} · ${report.cases.length} perguntas em ${report.ms.toFixed(1)} ms`,
);
process.exitCode = report.passed ? 0 : 1;
