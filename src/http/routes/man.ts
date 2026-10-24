import express from "express";
import type { DescribeCommands } from "../../application/describe-commands.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";

/**
 * The terminal's manual: GET / lists the pages, GET /:command returns one. Fixed text per image, so
 * it is cacheable, but still a read a visitor triggers, so it goes through a bucket.
 */
export function manRouter(describeCommands: DescribeCommands, reads = new TokenBucket(60, 120)) {
  const router = express.Router();
  const limit = rateLimit(reads, "Leituras demais seguidas no manual. Tenta de novo em instantes.");

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    next();
  });

  router.get("/", limit, (_req, res) => {
    res.json(describeCommands.list());
  });

  router.get("/:command", limit, (req, res) => {
    const wanted = String(req.params.command).slice(0, 40);
    const page = describeCommands.page(wanted);
    if (!page) {
      res.status(404).json({ error: `não há página de manual para '${wanted}'` });
      return;
    }
    res.json(page);
  });

  return router;
}
