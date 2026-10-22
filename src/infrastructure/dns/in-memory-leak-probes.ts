import { randomBytes } from "node:crypto";
import type { LeakProbe, LeakProbes, ResolverSighting } from "../../domain/dns-leak.js";

export interface LeakProbeLimits {
  ttlMs?: number; // how long a probe accepts queries and keeps its sightings
  maxProbes?: number; // live probes across every visitor
  maxSightings?: number; // distinct resolvers kept per probe
}

/**
 * Probes and their sightings in memory. Tokens are 16 lowercase hex characters: DNS names are
 * case-insensitive and resolvers randomise the case of what they forward (0x20), so case carries nothing.
 */
export class InMemoryLeakProbes implements LeakProbes {
  private readonly probes = new Map<string, { hostname: string; expiresAt: number; sightings: ResolverSighting[] }>();
  private readonly ttlMs: number;
  private readonly maxProbes: number;
  private readonly maxSightings: number;

  constructor(
    private readonly zone: string,
    { ttlMs = 5 * 60_000, maxProbes = 2_000, maxSightings = 8 }: LeakProbeLimits = {},
    private readonly now: () => number = Date.now,
    private readonly token: () => string = () => randomBytes(8).toString("hex"),
  ) {
    this.ttlMs = ttlMs;
    this.maxProbes = maxProbes;
    this.maxSightings = maxSightings;
  }

  get live(): number {
    this.sweep();
    return this.probes.size;
  }

  issue(): LeakProbe | null {
    this.sweep();
    if (this.probes.size >= this.maxProbes) return null;
    const token = this.token();
    const expiresAt = this.now() + this.ttlMs;
    const hostname = `${token}.${this.zone}`;
    this.probes.set(token, { hostname, expiresAt, sightings: [] });
    return { token, hostname, expiresAt: new Date(expiresAt).toISOString() };
  }

  record(token: string, sighting: Omit<ResolverSighting, "at">): boolean {
    const probe = this.alive(token.toLowerCase());
    if (!probe) return false;
    // A resolver asks for A and AAAA, and retries: one entry per resolver address, first query wins.
    const seen = probe.sightings.find((s) => s.address === sighting.address);
    if (seen) {
      if (!seen.qtype.split(",").includes(sighting.qtype)) seen.qtype += `,${sighting.qtype}`;
      seen.clientSubnet ??= sighting.clientSubnet;
    } else if (probe.sightings.length < this.maxSightings) {
      probe.sightings.push({ ...sighting, at: new Date(this.now()).toISOString() });
    }
    return true;
  }

  sightings(token: string): ResolverSighting[] | null {
    const probe = this.alive(token.toLowerCase());
    return probe ? probe.sightings.map((s) => ({ ...s })) : null;
  }

  private alive(token: string) {
    const probe = this.probes.get(token);
    if (!probe) return null;
    if (probe.expiresAt <= this.now()) {
      this.probes.delete(token);
      return null;
    }
    return probe;
  }

  // Map iteration follows insertion, and every probe lives as long as the others: the oldest expire first.
  private sweep() {
    const now = this.now();
    for (const [token, probe] of this.probes) {
      if (probe.expiresAt > now) break;
      this.probes.delete(token);
    }
  }
}
