import type { LoadTarget } from "../../domain/load.js";

/**
 * A route of this same server, hit over loopback: the load goes through the real HTTP stack
 * (middleware, logging, metrics), so its latency is what a visitor would see minus the network.
 * Only fixed paths are ever built, so a visitor can never point the lab anywhere else.
 */
export class LoopbackTarget implements LoadTarget {
  constructor(
    readonly name: string,
    readonly path: string,
    private readonly baseUrl: string,
    private readonly timeoutMs = 2_000,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async hit(signal: AbortSignal): Promise<{ status: number; ms: number }> {
    const started = performance.now();
    try {
      const res = await this.fetchFn(new URL(this.path, this.baseUrl), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
        headers: { "x-load-lab": "1" },
      });
      await res.arrayBuffer(); // the whole body, so the time covers the full response
      return { status: res.status, ms: performance.now() - started };
    } catch {
      return { status: 0, ms: performance.now() - started };
    }
  }
}
