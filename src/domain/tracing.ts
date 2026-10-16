export type SpanAttrs = Record<string, string | number | boolean | null>;

export interface SpanRecord {
  name: string;
  startMs: number; // since the request started
  durationMs: number;
  error: boolean;
  attrs: SpanAttrs;
}

export interface TraceRecord {
  id: string;
  route: string; // "POST /api/ask", as in the metrics
  status: number;
  startedAt: string;
  durationMs: number;
  spans: SpanRecord[];
  droppedSpans: number; // past the per-trace cap; the trace keeps the first ones
}

/** Times the steps of the request in progress. Attributes are set by code, never copied from the visitor's input. */
export interface Trace {
  span<T>(name: string, step: () => T | Promise<T>, attrs?: SpanAttrs): Promise<T>;
}

/** A trace still being recorded: the request it belongs to has not finished yet. */
export interface ActiveTrace extends Trace {
  readonly id: string;
  end(route: string, status: number): void;
}

/** Where finished traces are kept, bounded, for `trace <id>`. */
export interface TraceStore {
  start(): ActiveTrace;
  get(id: string): TraceRecord | null;
}
