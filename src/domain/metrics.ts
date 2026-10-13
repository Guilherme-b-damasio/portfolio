export interface RouteSnapshot {
  route: string;
  count: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
}

export interface MetricsSnapshot {
  uptimeSeconds: number;
  requestsLastMinute: number;
  memory: { rssMb: number; heapUsedMb: number };
  runtime: { node: string; pod: string; node_name: string | null; namespace: string | null };
  build: { commit: string; builtAt: string | null };
  routes: RouteSnapshot[];
}

/** Collects per-route request stats and exposes them as a snapshot or in Prometheus format. */
export interface MetricsStore {
  record(route: string, ms: number, isError: boolean): void;
  snapshot(): MetricsSnapshot;
  prometheus(): string;
}

export interface HistoryPoint {
  t: number; // epoch ms of the sample
  requestsLastMinute: number;
  rssMb: number;
}

/** A bounded, in-process series of past snapshots, for sparklines. Resets when the pod restarts. */
export interface MetricsHistory {
  readonly intervalMs: number;
  points(): HistoryPoint[];
}
