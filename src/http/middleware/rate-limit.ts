import type { RequestHandler } from "express";

/** In-memory token bucket per client IP. Good enough for one replica; move to Redis if the deployment scales out. */
export function rateLimit({ capacity, refillPerMinute }: { capacity: number; refillPerMinute: number }): RequestHandler {
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  return (req, res, next) => {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.updatedAt) / 60_000) * refillPerMinute);
    bucket.updatedAt = now;

    res.setHeader("X-RateLimit-Limit", capacity);
    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("Retry-After", Math.ceil(((1 - bucket.tokens) / refillPerMinute) * 60));
      res.status(429).json({ error: "Muitas perguntas seguidas. Tenta de novo em instantes." });
      return;
    }
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    res.setHeader("X-RateLimit-Remaining", Math.floor(bucket.tokens));
    next();
  };
}
