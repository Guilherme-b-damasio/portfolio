import { LoadLabBusy, type LoadPlan, type LoadSample, type LoadSummary, type LoadTarget } from "../domain/load.js";
import { RunLoad } from "./run-load.js";

/** What a visitor may ask for. The VPS is small: one run at a time, short, and a short line behind it. */
export const LOAD_LIMITS = {
  requests: { min: 1, max: 200 },
  concurrency: { min: 1, max: 10 },
  maxWaiting: 5,
} as const;

export interface LoadEvents {
  onQueued?(position: number): void; // 1 = next; sent again every time the line moves
  onStart?(plan: LoadPlan & { path: string }): void;
  onSample?(sample: LoadSample): void;
}

interface Waiting {
  start(): void;
  notify(position: number): void;
}

/**
 * The load lab: a single runner shared by every visitor, with a visible waiting line. A visitor who
 * leaves (signal aborted) stops their run or gives up their place, and the next one starts at once.
 */
export class LoadLab {
  private running = false;
  private readonly waiting: Waiting[] = [];
  private readonly targets: Map<string, LoadTarget>;

  constructor(
    targets: LoadTarget[],
    private readonly runner = new RunLoad(),
  ) {
    this.targets = new Map(targets.map((t) => [t.name, t]));
  }

  get targetList(): { name: string; path: string }[] {
    return [...this.targets.values()].map(({ name, path }) => ({ name, path }));
  }

  get state() {
    return { running: this.running, waiting: this.waiting.length, limits: LOAD_LIMITS, targets: this.targetList };
  }

  /** Waits for its turn, then fires the plan. Throws LoadLabBusy when the line is full. */
  async run(plan: LoadPlan, events: LoadEvents, signal: AbortSignal): Promise<LoadSummary> {
    const target = this.targets.get(plan.target);
    if (!target) throw new RangeError(`unknown load target: ${plan.target}`);
    const bounded = {
      target: target.name,
      requests: clamp(plan.requests, LOAD_LIMITS.requests),
      concurrency: clamp(plan.concurrency, LOAD_LIMITS.concurrency),
    };
    signal.throwIfAborted();

    if (this.running) {
      if (this.waiting.length >= LOAD_LIMITS.maxWaiting)
        throw new LoadLabBusy("A fila do laboratório de carga está cheia. Tenta de novo em instantes.");
      await this.queue(events, signal); // resolves with the runner already handed over
    } else {
      this.running = true;
    }

    try {
      events.onStart?.({ ...bounded, path: target.path });
      return await this.runner.run(target, bounded, { onSample: events.onSample, signal });
    } finally {
      this.handOver();
    }
  }

  private queue(events: LoadEvents, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const leave = () => {
        this.waiting.splice(this.waiting.indexOf(entry), 1);
        this.renumber();
        reject(signal.reason);
      };
      const entry: Waiting = {
        start: () => {
          signal.removeEventListener("abort", leave);
          resolve();
        },
        notify: (position) => events.onQueued?.(position),
      };
      this.waiting.push(entry);
      signal.addEventListener("abort", leave, { once: true });
      entry.notify(this.waiting.length);
    });
  }

  // The runner goes straight to the next in line, so a newcomer can never cut in between.
  private handOver() {
    const next = this.waiting.shift();
    if (!next) {
      this.running = false;
      return;
    }
    this.renumber();
    next.start();
  }

  private renumber() {
    this.waiting.forEach((w, i) => w.notify(i + 1));
  }
}

const clamp = (n: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, Math.floor(n) || min));
