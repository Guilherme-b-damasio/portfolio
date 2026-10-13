export interface BudgetUsage {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string; // ISO time the window starts over
}

/**
 * Caps how many LLM tokens the site spends in a window. Checked before a generation and charged
 * after it, so the last answer of the window may go slightly over; the concurrency cap bounds by how much.
 */
export interface TokenBudget {
  canSpend(): boolean;
  charge(tokens: number): void;
  usage(): BudgetUsage;
}
