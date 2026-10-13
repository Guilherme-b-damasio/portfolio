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
