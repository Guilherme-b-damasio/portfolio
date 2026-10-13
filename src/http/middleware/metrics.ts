import type { RequestHandler } from "express";
import type { MetricsStore } from "../../domain/metrics.js";

/** Records latency and errors per matched route once the response is sent. */
export function recordMetrics(metrics: MetricsStore): RequestHandler {
  return (req, res, next) => {
    const start = performance.now();
    res.on("finish", () => {
      // Group by the matched route so /api/projects/:slug is one series, not one per slug.
      const route = `${req.method} ${req.route?.path ? req.baseUrl + req.route.path : req.path.startsWith("/api") ? req.path : "static"}`;
      metrics.record(route, performance.now() - start, res.statusCode >= 500);
    });
    next();
  };
}
