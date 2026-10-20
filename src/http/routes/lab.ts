import express from "express";
import { rateLimit, setRateLimitHeaders, TokenBucket } from "../middleware/rate-limit.js";

// Small on purpose: ten shots empty it, and it refills one token every 3 s.
export const LAB_CAPACITY = 10;
export const LAB_REFILL_PER_MINUTE = 20;

/**
 * The rate limit lab: a bucket of its own per visitor, so emptying it here never costs a question.
 * Each shot is one O(1) bucket operation, and the answer is in the headers, the same ones every
 * limited route sends.
 */
export function labRouter(bucket = new TokenBucket(LAB_CAPACITY, LAB_REFILL_PER_MINUTE)) {
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store"); // every shot has to reach the bucket
    next();
  });

  // The balance without spending, to draw the bucket before the first shot.
  router.get("/ratelimit/bucket", (req, res) => {
    const state = bucket.peek(req.ip ?? "unknown");
    setRateLimitHeaders(res, state);
    res.json(state);
  });

  router.get(
    "/ratelimit",
    rateLimit(bucket, "O balde do laboratório esvaziou. Espera o Retry-After e ele volta a encher."),
    (_req, res) => {
      res.json({ ok: true });
    },
  );

  return router;
}
