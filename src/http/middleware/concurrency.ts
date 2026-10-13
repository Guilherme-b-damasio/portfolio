import type { RequestHandler } from "express";

/**
 * Caps how many requests run at once across all visitors. The per-visitor bucket stops one
 * visitor from flooding; this stops many visitors together from piling LLM calls onto the VPS.
 */
export class ConcurrencyGate {
  private running = 0;

  constructor(
    readonly limit: number,
    readonly retryAfterSeconds = 5,
  ) {}

  get inFlight(): number {
    return this.running;
  }

  /** Takes a slot if one is free and returns its release function (safe to call twice), or null when full. */
  tryAcquire(): (() => void) | null {
    if (this.running >= this.limit) return null;
    this.running++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running--;
    };
  }
}

export function concurrencyCap(gate: ConcurrencyGate): RequestHandler {
  return (_req, res, next) => {
    const release = gate.tryAcquire();
    if (!release) {
      res.setHeader("Retry-After", gate.retryAfterSeconds);
      res.status(503).json({ error: "Muita gente perguntando ao mesmo tempo. Tenta de novo em instantes." });
      return;
    }
    // "close" fires after the response is sent and also when the client gives up mid-answer.
    res.once("close", release);
    next();
  };
}
