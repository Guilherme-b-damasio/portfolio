import type { TraceRecord, TraceStore } from "../domain/tracing.js";

/** One finished request, step by step, for `trace <id>` in the terminal. */
export class ShowTrace {
  constructor(private readonly traces: TraceStore) {}

  byId(id: string): TraceRecord | null {
    return this.traces.get(id);
  }
}
