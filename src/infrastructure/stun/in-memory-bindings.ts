import type { NatBindings, StunSighting } from "../../domain/stun.js";

export interface NatBindingLimits {
  ttlMs?: number; // how long a sighting is readable
  maxAddresses?: number; // addresses kept at once, across every visitor
  maxPerAddress?: number; // sightings kept per address
}

/**
 * Binding requests in memory, by the address they came from. The STUN server is open to the whole
 * internet and nobody can prove who they are over it, so the store is small, short-lived and
 * stops growing when it is full: a flood loses its own entries, never anyone else's.
 */
export class InMemoryNatBindings implements NatBindings {
  private readonly byAddress = new Map<string, StunSighting[]>();
  private readonly ttlMs: number;
  private readonly maxAddresses: number;
  private readonly maxPerAddress: number;

  constructor(
    { ttlMs = 2 * 60_000, maxAddresses = 2_000, maxPerAddress = 6 }: NatBindingLimits = {},
    private readonly now: () => number = Date.now,
  ) {
    this.ttlMs = ttlMs;
    this.maxAddresses = maxAddresses;
    this.maxPerAddress = maxPerAddress;
  }

  get live(): number {
    this.sweep();
    return this.byAddress.size;
  }

  record(sighting: Omit<StunSighting, "at">): void {
    this.sweep();
    const seen = this.byAddress.get(sighting.address);
    if (!seen) {
      if (this.byAddress.size >= this.maxAddresses) return;
      this.byAddress.set(sighting.address, [{ ...sighting, at: this.stamp() }]);
      return;
    }
    // ICE retries every candidate a few times: one entry per reflexive port and socket of ours.
    const known = seen.find((s) => s.port === sighting.port && s.serverPort === sighting.serverPort);
    if (known) {
      known.software ??= sighting.software;
      return;
    }
    if (seen.length < this.maxPerAddress) seen.push({ ...sighting, at: this.stamp() });
  }

  forAddress(address: string): StunSighting[] {
    this.sweep();
    return (this.byAddress.get(address) ?? []).map((s) => ({ ...s }));
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  // Entries are ordered by their first sighting and all live equally long: the oldest expire first.
  private sweep() {
    const oldest = this.now() - this.ttlMs;
    for (const [address, sightings] of this.byAddress) {
      if (Date.parse(sightings[0].at) > oldest) break;
      this.byAddress.delete(address);
    }
  }
}
