import type { HistoryPoint, MetricsHistory, MetricsSnapshot, MetricsStore } from "../domain/metrics.js";

export interface Status extends MetricsSnapshot {
  llm: string | null;
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
  ) {}

  status(): Status {
    return { ...this.metrics.snapshot(), llm: this.llmModel };
  }

  history(): StatusHistory {
    return { intervalSeconds: this.metricsHistory.intervalMs / 1000, points: this.metricsHistory.points() };
  }

  prometheus(): string {
    return this.metrics.prometheus();
  }
}
