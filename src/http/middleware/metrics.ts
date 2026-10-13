import type { RequestHandler } from "express";
import type { MetricsStore } from "../../domain/metrics.js";
import { routeLabel } from "../route-label.js";

/** Records latency and errors per matched route once the response is sent. */
export function recordMetrics(metrics: MetricsStore): RequestHandler {
  return (req, res, next) => {
    const start = performance.now();
    res.on("finish", () => {
      metrics.record(routeLabel(req), performance.now() - start, res.statusCode >= 500);
    });
    next();
  };
}
