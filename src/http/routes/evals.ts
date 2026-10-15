import express from "express";
import type { ShowEvals } from "../../application/show-evals.js";

/** The retrieval eval as this server scores it: GET /api/evals?engine=local. */
export function evalsRouter(showEvals: ShowEvals) {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    const engine = typeof req.query.engine === "string" ? req.query.engine : "local";
    const outcome = showEvals.report(engine);
    if (!outcome) {
      res.status(404).json({ error: `engine '${engine.slice(0, 20)}' não existe`, engines: showEvals.engineNames });
      return;
    }
    try {
      res.json({ engines: showEvals.engineNames, report: await outcome });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
