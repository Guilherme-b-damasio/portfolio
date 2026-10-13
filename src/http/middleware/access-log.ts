import type { RequestHandler } from "express";
import type { Logger } from "../../domain/logger.js";
import { routeLabel } from "../route-label.js";

/** One structured line per finished request. Probe paths are skipped so liveness checks don't drown the log. */
export function accessLog(logger: Logger, skip: string[] = ["/healthz"]): RequestHandler {
  return (req, res, next) => {
    if (skip.includes(req.path)) return next();
    const start = performance.now();
    res.on("finish", () => {
      logger.info("request", {
        requestId: res.locals.requestId,
        route: routeLabel(req),
        status: res.statusCode,
        ms: Math.round((performance.now() - start) * 10) / 10,
      });
    });
    next();
  };
}
