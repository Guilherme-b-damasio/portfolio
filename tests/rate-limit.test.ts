import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/http/middleware/rate-limit.js";

describe("TokenBucket", () => {
  it("spends tokens until empty and then refuses with a retry delay", () => {
    const bucket = new TokenBucket(2, 6, () => 0);
    expect(bucket.take("a").allowed).toBe(true);
    expect(bucket.take("a").state.remaining).toBe(0);
    const refused = bucket.take("a");
    expect(refused.allowed).toBe(false);
    expect(refused.state.retryAfterSeconds).toBe(10); // 6 per minute = one every 10s
  });

  it("refills over time and keeps visitors apart", () => {
    let now = 0;
    const bucket = new TokenBucket(2, 6, () => now);
    bucket.take("a");
    bucket.take("a");
    expect(bucket.peek("b").remaining).toBe(2);
    now = 10_000;
    expect(bucket.peek("a")).toEqual({ limit: 2, remaining: 1, refillPerMinute: 6, retryAfterSeconds: 0 });
  });

  it("peeking never spends", () => {
    const bucket = new TokenBucket(1, 1, () => 0);
    bucket.peek("a");
    bucket.peek("a");
    expect(bucket.take("a").allowed).toBe(true);
  });
});
