import { randomBytes } from "node:crypto";
import type { ActiveTrace, SpanAttrs, SpanRecord, TraceRecord, TraceStore } from "../../domain/tracing.js";

export interface InMemoryTracesOptions {
  capacity?: number; // finished traces kept; the oldest is dropped first
  maxSpans?: number; // spans kept per trace
  newId?: () => string;
  now?: () => number; // ms, monotonic
  clock?: () => Date;
}

/**
 * Finished traces in a ring buffer: a few hundred requests of history in well under a megabyte.
 * Ids are random, so a trace can only be read by whoever got its `x-trace-id`.
 */
export class InMemoryTraces implements TraceStore {
  private readonly traces = new Map<string, TraceRecord>(); // insertion order = age
  private readonly capacity: number;
  private readonly maxSpans: number;
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly clock: () => Date;

  constructor({
    capacity = 500,
    maxSpans = 32,
    newId = () => randomBytes(8).toString("hex"),
    now = () => performance.now(),
    clock = () => new Date(),
  }: InMemoryTracesOptions = {}) {
    this.capacity = capacity;
    this.maxSpans = maxSpans;
    this.newId = newId;
    this.now = now;
    this.clock = clock;
  }

  start(): ActiveTrace {
    const id = this.newId();
    const t0 = this.now();
    const startedAt = this.clock().toISOString();
    const spans: SpanRecord[] = [];
    let dropped = 0;
    let ended = false;
    const round = (ms: number) => Math.round(ms * 10) / 10;

    const record = (name: string, start: number, error: boolean, attrs: SpanAttrs) => {
      if (ended) return; // a step that outlived its request (e.g. an aborted generation) is not added afterwards
      if (spans.length >= this.maxSpans) dropped++;
      else spans.push({ name, startMs: round(start - t0), durationMs: round(this.now() - start), error, attrs });
    };

    return {
      id,
      span: async (name, step, attrs = {}) => {
        const start = this.now();
        try {
          const result = await step();
          record(name, start, false, attrs);
          return result;
        } catch (err) {
          record(name, start, true, attrs);
          throw err;
        }
      },
      end: (route, status) => {
        if (ended) return;
        ended = true;
        this.keep({ id, route, status, startedAt, durationMs: round(this.now() - t0), spans, droppedSpans: dropped });
      },
    };
  }

  get(id: string): TraceRecord | null {
    return this.traces.get(id) ?? null;
  }

  private keep(trace: TraceRecord): void {
    this.traces.set(trace.id, trace);
    if (this.traces.size > this.capacity) this.traces.delete(this.traces.keys().next().value!);
  }
}
