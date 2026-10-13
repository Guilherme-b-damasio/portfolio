import os from "node:os";
import type { MetricsSnapshot, MetricsStore } from "../../domain/metrics.js";

const WINDOW = 500; // latency samples kept per route

interface RouteStats {
  count: number;
  errors: number;
  latencies: number[];
}

/** Per-process metrics with a sliding latency window per route. One replica, so memory is the source of truth. */
export class InMemoryMetrics implements MetricsStore {
  private readonly routes = new Map<string, RouteStats>();
  private readonly startedAt = Date.now();
  private readonly recent: number[] = []; // request timestamps of the last minute

  record(route: string, ms: number, isError: boolean) {
    const stats = this.routes.get(route) ?? { count: 0, errors: 0, latencies: [] };
    stats.count++;
    if (isError) stats.errors++;
    stats.latencies.push(ms);
    if (stats.latencies.length > WINDOW) stats.latencies.shift();
    this.routes.set(route, stats);

    const now = Date.now();
    this.recent.push(now);
    while (this.recent.length && this.recent[0] < now - 60_000) this.recent.shift();
  }

  snapshot(): MetricsSnapshot {
    const mem = process.memoryUsage();
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      requestsLastMinute: this.recent.filter((t) => t >= Date.now() - 60_000).length,
      memory: { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed) },
      runtime: {
        node: process.version,
        // Filled by the Kubernetes Downward API in k8s/deployment.yaml; falls back to the host locally.
        pod: process.env.POD_NAME ?? os.hostname(),
        node_name: process.env.NODE_NAME ?? null,
        namespace: process.env.POD_NAMESPACE ?? null,
      },
      build: { commit: process.env.GIT_SHA ?? "dev", builtAt: process.env.BUILT_AT ?? null },
      routes: [...this.routes].map(([route, s]) => ({
        route,
        count: s.count,
        errors: s.errors,
        p50Ms: round(percentile(s.latencies, 0.5)),
        p95Ms: round(percentile(s.latencies, 0.95)),
      })),
    };
  }

  /** Prometheus text exposition format, so the cluster can scrape /metrics. */
  prometheus(): string {
    const lines = [
      "# TYPE portfolio_requests_total counter",
      ...[...this.routes].map(([r, s]) => `portfolio_requests_total{route="${r}"} ${s.count}`),
      "# TYPE portfolio_errors_total counter",
      ...[...this.routes].map(([r, s]) => `portfolio_errors_total{route="${r}"} ${s.errors}`),
      "# TYPE portfolio_latency_p95_ms gauge",
      ...[...this.routes].map(([r, s]) => `portfolio_latency_p95_ms{route="${r}"} ${round(percentile(s.latencies, 0.95))}`),
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes ${process.memoryUsage().rss}`,
    ];
    return lines.join("\n") + "\n";
  }
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
const round = (n: number) => Math.round(n * 10) / 10;
