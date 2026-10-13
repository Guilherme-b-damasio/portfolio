import type { BudgetUsage, TokenBudget } from "../../domain/token-budget.js";

const DAY_MS = 86_400_000;

/**
 * Token budget that starts over at 00:00 UTC. Kept in memory, so a pod restart also starts it over;
 * the per-visitor bucket and the concurrency cap still bound what a restart can let through.
 */
export class DailyTokenBudget implements TokenBudget {
  private day = -1;
  private used = 0;

  constructor(
    readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  canSpend(): boolean {
    this.roll();
    return this.used < this.limit;
  }

  charge(tokens: number): void {
    this.roll();
    this.used += Math.max(0, tokens);
  }

  usage(): BudgetUsage {
    this.roll();
    return {
      limit: this.limit,
      used: this.used,
      remaining: Math.max(0, this.limit - this.used),
      resetsAt: new Date((this.day + 1) * DAY_MS).toISOString(),
    };
  }

  private roll() {
    const today = Math.floor(this.now() / DAY_MS);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
  }
}
