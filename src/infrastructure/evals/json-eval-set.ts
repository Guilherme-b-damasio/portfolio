import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { EvalSet } from "../../domain/evaluation.js";

const evalSet = z.object({
  k: z.number().int().min(1).max(20),
  minRecall: z.number().min(0).max(1),
  cases: z
    .array(z.object({ question: z.string().min(2).max(500), expected: z.array(z.string().min(1)).min(1) }))
    .min(1),
});

/** Reads an eval set (`data/evals/rag.json`), rejecting one that is malformed rather than scoring it. */
export async function loadEvalSet(file: string): Promise<EvalSet> {
  return evalSet.parse(JSON.parse(await readFile(file, "utf8")));
}
