import { Resolver } from "node:dns/promises";
import type { ReverseDns } from "../../domain/exposure.js";

/**
 * PTR lookup with a hard deadline: a slow resolver must not hold the visitor's request.
 * No cache on purpose, so no visitor IP outlives its own request.
 */
export class DnsReverseLookup implements ReverseDns {
  constructor(
    private readonly timeoutMs = 800,
    private readonly resolver: Pick<Resolver, "reverse"> = new Resolver({ timeout: timeoutMs, tries: 1 }),
  ) {}

  async lookup(ip: string): Promise<string | null> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.timeoutMs);
    });
    try {
      const names = await Promise.race([this.resolver.reverse(ip).catch(() => null), deadline]);
      return names?.[0] ?? null;
    } finally {
      clearTimeout(timer);
    }
  }
}
