import type { HistoryPoint, MetricsHistory, MetricsSnapshot, MetricsStore } from "../domain/metrics.js";
import type { BudgetUsage, TokenBudget } from "../domain/token-budget.js";

export interface Status extends MetricsSnapshot {
  llm: string | null;
  llmBudget: BudgetUsage | null;
  cluster: { namespaces: readonly string[] } | null; // null outside a cluster: the panel stays off
}

export interface StatusHistory {
  intervalSeconds: number;
  points: HistoryPoint[];
}

/** What the "Ao vivo" panel and `status` command show: process metrics plus the active model. */
export class ReportStatus {
  constructor(
    private readonly metrics: MetricsStore,
    private readonly llmModel: string | null,
    private readonly metricsHistory: MetricsHistory,
    private readonly budget: TokenBudget | null = null,
    private readonly clusterNamespaces: readonly string[] | null = null,
  ) {}

  status(): Status {
    return {
      ...this.metrics.snapshot(),
      llm: this.llmModel,
      llmBudget: this.budget?.usage() ?? null,
      cluster: this.clusterNamespaces ? { namespaces: this.clusterNamespaces } : null,
    };
  }

  history(): StatusHistory {
    return { intervalSeconds: this.metricsHistory.intervalMs / 1000, points: this.metricsHistory.points() };
  }

  prometheus(): string {
    if (!this.budget) return this.metrics.prometheus();
    const { used, limit } = this.budget.usage();
    return [
      this.metrics.prometheus(),
      "# HELP portfolio_llm_tokens_used_today LLM tokens spent since 00:00 UTC",
      "# TYPE portfolio_llm_tokens_used_today gauge",
      `portfolio_llm_tokens_used_today ${used}`,
      "# HELP portfolio_llm_tokens_daily_limit LLM_DAILY_TOKEN_BUDGET",
      "# TYPE portfolio_llm_tokens_daily_limit gauge",
      `portfolio_llm_tokens_daily_limit ${limit}`,
      "",
    ].join("\n");
  }
}
