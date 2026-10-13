import type { MetricsSnapshot, MetricsStore } from "../domain/metrics.js";

export interface Status extends MetricsSnapshot {
  llm: string | null;
}

/** What the "Ao vivo" panel and `status` command show: process metrics plus the active model. */
export class ReportStatus {
  constructor(
    private readonly metrics: MetricsStore,
    private readonly llmModel: string | null,
  ) {}

  status(): Status {
    return { ...this.metrics.snapshot(), llm: this.llmModel };
  }

  prometheus(): string {
    return this.metrics.prometheus();
  }
}
