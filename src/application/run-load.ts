import type { LoadPlan, LoadSample, LoadSummary, LoadTarget } from "../domain/load.js";

/**
 * Fires a plan at a target: `concurrency` workers pull the next request until the plan is done or
 * the signal aborts. A request that throws counts as status 0, so one bad hit never stops the run.
 */
export class RunLoad {
  constructor(private readonly now: () => number = () => performance.now()) {}

  async run(
    target: LoadTarget,
    plan: LoadPlan,
    { onSample, signal }: { onSample?: (sample: LoadSample) => void; signal: AbortSignal },
  ): Promise<LoadSummary> {
    const samples: LoadSample[] = [];
    const started = this.now();
    let fired = 0;

    const worker = async () => {
      while (fired < plan.requests && !signal.aborted) {
        const index = ++fired;
        const at = this.now();
        const { status, ms } = await target.hit(signal).catch(() => ({ status: 0, ms: this.now() - at }));
        const sample = { index, status, ms: round(ms) };
        samples.push(sample);
        onSample?.(sample);
      }
    };
    await Promise.all(Array.from({ length: Math.min(plan.concurrency, plan.requests) }, worker));

    return summarize(plan, samples, this.now() - started);
  }
}

export function summarize(plan: LoadPlan, samples: LoadSample[], durationMs: number): LoadSummary {
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const ok = samples.filter((s) => s.status >= 200 && s.status < 300).length;
  return {
    target: plan.target,
    requests: samples.length,
    concurrency: plan.concurrency,
    ok,
    failed: samples.length - ok,
    durationMs: round(durationMs),
    rps: durationMs > 0 ? round((samples.length / durationMs) * 1000) : 0,
    p50Ms: nearestRank(sorted, 0.5),
    p95Ms: nearestRank(sorted, 0.95),
    p99Ms: nearestRank(sorted, 0.99),
    maxMs: sorted.at(-1) ?? 0,
  };
}

function nearestRank(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

const round = (n: number) => Math.round(n * 10) / 10;
