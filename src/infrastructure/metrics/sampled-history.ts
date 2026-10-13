import type { HistoryPoint, MetricsHistory, MetricsStore } from "../../domain/metrics.js";

/** Samples a MetricsStore on a fixed interval into a ring buffer. 288 × 5 min = 24h in a few KB. */
export class SampledHistory implements MetricsHistory {
  private readonly buffer: HistoryPoint[] = [];

  constructor(
    private readonly source: MetricsStore,
    readonly intervalMs = 5 * 60_000,
    private readonly capacity = 288,
    private readonly now: () => number = Date.now,
  ) {}

  sample() {
    const { requestsLastMinute, memory } = this.source.snapshot();
    this.buffer.push({ t: this.now(), requestsLastMinute, rssMb: memory.rssMb });
    if (this.buffer.length > this.capacity) this.buffer.shift();
  }

  points(): HistoryPoint[] {
    return [...this.buffer];
  }

  /** Takes a first sample now and then one per interval. The timer never keeps the process alive. */
  start(): () => void {
    this.sample();
    const timer = setInterval(() => this.sample(), this.intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
