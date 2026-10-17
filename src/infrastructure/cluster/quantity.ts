// Kubernetes resource quantities ("250m", "1", "120Mi", "1G", "512n") as plain numbers.

const DECIMAL: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  "": 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};
const BINARY: Record<string, number> = { Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, Ei: 2 ** 60 };
const QUANTITY = /^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei|[numkMGTPE]?)$/;

/** The quantity's value in base units (cores, bytes), or null when it is not a quantity. */
export function parseQuantity(text: string): number | null {
  const match = QUANTITY.exec(text.trim());
  if (!match) return null;
  const [, number, suffix] = match;
  // "1e3" already carries its exponent; an "E" right after digits without one is the exa suffix.
  const scale = BINARY[suffix] ?? DECIMAL[suffix];
  return Number(number) * scale;
}

/** CPU in millicores, rounded: "250m" → 250, "1" → 1000, "123456789n" → 123. */
export function cpuMilli(text: string): number | null {
  const cores = parseQuantity(text);
  return cores == null ? null : Math.round(cores * 1000);
}

/** Memory in whole bytes: "64Mi" → 67108864. */
export function bytes(text: string): number | null {
  const value = parseQuantity(text);
  return value == null ? null : Math.round(value);
}
