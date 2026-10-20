/** One request a load run fired: its place in the run, how it ended and how long it took. */
export interface LoadSample {
  index: number; // 1-based, in the order they were fired
  status: number; // 0 when it never got an answer (timeout, connection refused)
  ms: number;
}

/** What a visitor asks the lab to fire. Bounded by the use case, never trusted as is. */
export interface LoadPlan {
  target: string; // a name from the lab's whitelist, never a URL
  requests: number;
  concurrency: number;
}

export interface LoadSummary {
  target: string;
  requests: number;
  concurrency: number;
  ok: number; // 2xx
  failed: number;
  durationMs: number;
  rps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

/** Something a load run can hit: one request per call, never longer than its own timeout. */
export interface LoadTarget {
  readonly name: string;
  readonly path: string; // shown to the visitor, so they can see exactly what is being hit
  hit(signal: AbortSignal): Promise<{ status: number; ms: number }>;
}

/** The lab's single runner is taken and its waiting line is full. */
export class LoadLabBusy extends Error {
  override name = "LoadLabBusy";
}
