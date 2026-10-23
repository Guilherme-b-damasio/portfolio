import type { CrowdCounts, Rarity, Trait } from "../../domain/anonymity.js";

export interface InMemoryCrowdOptions {
  maxValues?: number; // distinct values kept per attribute
  maxValueLength?: number;
  now?: () => Date;
}

/** Where values past the ceiling are counted, so the totals stay true without growing. */
export const OVERFLOW = "(outros)";

/**
 * The counters behind "1 em N visitantes". One map per attribute, from value to how many times it
 * was seen, and nothing else: no visitor, no session, no pair of attributes together. Each
 * attribute keeps at most `maxValues` distinct values and counts the rest in one overflow bucket,
 * so a visitor who sends a brand new value every time cannot grow the process. Counting starts
 * over on every restart.
 */
export class InMemoryCrowd implements CrowdCounts {
  private readonly byAttribute = new Map<string, Map<string, number>>();
  private readonly totals = new Map<string, number>();
  private readonly maxValues: number;
  private readonly maxValueLength: number;
  private readonly startedAt: Date;
  private visitors = 0;

  constructor({ maxValues = 200, maxValueLength = 120, now = () => new Date() }: InMemoryCrowdOptions = {}) {
    this.maxValues = maxValues;
    this.maxValueLength = maxValueLength;
    this.startedAt = now();
  }

  get since(): string {
    return this.startedAt.toISOString();
  }

  get counted(): number {
    return this.visitors;
  }

  record(traits: readonly Trait[]): void {
    if (!traits.length) return;
    this.visitors += 1;
    for (const trait of traits) {
      const values = this.byAttribute.get(trait.attribute) ?? new Map<string, number>();
      const key = this.keyOf(values, trait.value);
      values.set(key, (values.get(key) ?? 0) + 1);
      this.byAttribute.set(trait.attribute, values);
      this.totals.set(trait.attribute, (this.totals.get(trait.attribute) ?? 0) + 1);
    }
  }

  rarity(traits: readonly Trait[]): Rarity[] {
    const out: Rarity[] = [];
    for (const trait of traits) {
      const values = this.byAttribute.get(trait.attribute);
      const total = this.totals.get(trait.attribute) ?? 0;
      if (!values || !total) continue;
      const value = this.trim(trait.value);
      const matching = values.get(value) ?? values.get(OVERFLOW) ?? 0;
      if (!matching) continue;
      out.push({
        ...trait,
        value,
        matching,
        total,
        oneIn: Math.max(1, Math.round(total / matching)),
        capped: !values.has(value),
      });
    }
    return out.sort((a, b) => b.oneIn - a.oneIn);
  }

  /** The bucket a value is counted in: itself, or the overflow once the attribute is full. */
  private keyOf(values: Map<string, number>, value: string): string {
    const trimmed = this.trim(value);
    if (values.has(trimmed) || values.size < this.maxValues) return trimmed;
    return OVERFLOW;
  }

  private trim(value: string): string {
    return value.length > this.maxValueLength ? `${value.slice(0, this.maxValueLength - 1)}…` : value;
  }
}
