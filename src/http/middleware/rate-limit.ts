import type { RequestHandler, Response } from "express";

export interface BucketState {
  limit: number;
  remaining: number;
  refillPerMinute: number;
  retryAfterSeconds: number; // 0 when a token is available now
  resetSeconds: number; // until the bucket is full again; 0 when it is full
}

/** In-memory token bucket per client key. Good enough for one replica; move to Redis if the deployment scales out. */
export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    readonly capacity: number,
    readonly refillPerMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Spends one token if there is one. */
  take(key: string): { allowed: boolean; state: BucketState } {
    const tokens = this.refill(key);
    const allowed = tokens >= 1;
    this.store(key, allowed ? tokens - 1 : tokens);
    return { allowed, state: this.state(allowed ? tokens - 1 : tokens) };
  }

  /** Reads the bucket without spending, so the page can show the visitor's real balance. */
  peek(key: string): BucketState {
    return this.state(this.refill(key));
  }

  private refill(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return this.capacity;
    const elapsedMinutes = (this.now() - bucket.updatedAt) / 60_000;
    return Math.min(this.capacity, bucket.tokens + elapsedMinutes * this.refillPerMinute);
  }

  private store(key: string, tokens: number) {
    // A full bucket is the same as no bucket: dropping it keeps the map from growing with every visitor.
    if (tokens >= this.capacity) this.buckets.delete(key);
    else this.buckets.set(key, { tokens, updatedAt: this.now() });
  }

  private state(tokens: number): BucketState {
    return {
      limit: this.capacity,
      remaining: Math.floor(tokens),
      refillPerMinute: this.refillPerMinute,
      retryAfterSeconds: tokens >= 1 ? 0 : Math.ceil(((1 - tokens) / this.refillPerMinute) * 60),
      resetSeconds: Math.ceil(((this.capacity - tokens) / this.refillPerMinute) * 60),
    };
  }
}

/** The bucket on the response, so a client can draw it from the headers alone. */
export function setRateLimitHeaders(res: Response, state: BucketState) {
  res.setHeader("X-RateLimit-Limit", state.limit);
  res.setHeader("X-RateLimit-Remaining", state.remaining);
  res.setHeader("X-RateLimit-Reset", state.resetSeconds);
}

export function rateLimit(
  bucket: TokenBucket,
  message = "Muitas perguntas seguidas. Tenta de novo em instantes.",
): RequestHandler {
  return (req, res, next) => {
    const { allowed, state } = bucket.take(req.ip ?? "unknown");
    setRateLimitHeaders(res, state);
    if (!allowed) {
      res.setHeader("Retry-After", state.retryAfterSeconds);
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}
