/** One question of the retrieval eval, with the sources that should come back for it. */
export interface EvalCase {
  question: string;
  // "docsage.md" accepts any section of the file; "docsage.md › Decisões técnicas" only that one.
  expected: string[];
}

export interface EvalSet {
  k: number; // how deep a hit may be and still count
  minRecall: number; // CI fails below this
  cases: EvalCase[];
}

export interface EvalCaseResult {
  question: string;
  expected: string[];
  rank: number | null; // 1-based position of the first expected source, null when it missed the top k
  retrieved: string[]; // the sources that came back, best first
}

export interface EvalReport {
  engine: string;
  k: number;
  recall: number; // share of cases with an expected source in the top k
  mrr: number; // mean reciprocal rank, 0 for a miss
  minRecall: number;
  passed: boolean;
  cases: EvalCaseResult[];
  ranAt: string; // ISO time
  ms: number;
}

/** Whether a retrieved source is one the case expects. */
export function matchesExpected(source: string, expected: string): boolean {
  return source === expected || source.startsWith(`${expected} › `);
}
