/** One trait of a visitor as the crowd counts it: the attribute, how to say it, and the value. */
export interface Trait {
  attribute: string; // "gpu", "tela", "canvas"...
  label: string; // how the page names it
  value: string;
}

/** How rare one trait is among everyone counted so far. */
export interface Rarity extends Trait {
  matching: number; // how many counted visitors share this value
  total: number; // how many were counted with any value for this attribute
  oneIn: number; // total / matching, rounded: the "1 em N" the page shows
  capped: boolean; // the value fell into the overflow bucket, so `matching` is a ceiling
}

/**
 * Counts traits, never visitors: per attribute, how many times each value was seen. No two
 * attributes of the same visitor are ever tied to each other, so nothing kept here can be turned
 * back into a fingerprint of one person — which is the whole point of showing it.
 */
export interface CrowdCounts {
  /** Counts one visitor's traits. */
  record(traits: readonly Trait[]): void;
  /** How rare each trait is, leaving out the ones nobody has shown yet. */
  rarity(traits: readonly Trait[]): Rarity[];
  /** When this process started counting, ISO. Nothing survives a restart. */
  readonly since: string;
  /** How many visitors were counted since then. */
  readonly counted: number;
}

/** The crowd part of the scan: how common the visitor is among everyone this process has seen. */
export interface CrowdView {
  since: string;
  counted: number;
  traits: Rarity[]; // rarest first
}
