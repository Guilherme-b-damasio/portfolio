import path from "node:path";
import express from "express";
import type { Logger } from "../domain/logger.js";
import type { MetricsStore } from "../domain/metrics.js";
import type { TraceStore } from "../domain/tracing.js";
import { accessLog } from "./middleware/access-log.js";
import { recordMetrics } from "./middleware/metrics.js";
import { proxiedClient } from "./middleware/proxied-client.js";
import { requestId } from "./middleware/request-id.js";
import { securityHeaders } from "./middleware/security-headers.js";
import { tracing } from "./middleware/tracing.js";
import { apiRouter, askGuardsFor, type ApiDeps } from "./routes/api.js";
import { mcpRouter } from "./routes/mcp.js";

export interface AppDeps extends ApiDeps {
  metrics: MetricsStore;
  logger: Logger;
  publicDir: string;
  traces?: TraceStore | null; // without one, requests are not traced
  dnsLeakZone?: string | null; // the DNS leak test loads images from names under it
}

export function createApp({ metrics, logger, publicDir, traces, dnsLeakZone, ...apiDeps }: AppDeps) {
  const app = express();
  app.set("trust proxy", 1); // behind Traefik in k3s, so req.ip is the real client
  app.disable("x-powered-by");
  app.use(proxiedClient(apiDeps.tapped));
  app.use(requestId());
  app.use(securityHeaders({ imgSrc: dnsLeakZone ? [`https://*.${dnsLeakZone}`] : [] }));
  app.use(accessLog(logger));
  app.use(recordMetrics(metrics));
  if (traces) app.use(tracing(traces));
  app.use(express.json({ limit: "4kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4").send(apiDeps.reportStatus.prometheus());
  });

  const askGuards = askGuardsFor(apiDeps);
  app.use("/api", apiRouter(apiDeps, logger, askGuards));
  app.use("/mcp", mcpRouter(apiDeps, askGuards));
  app.use(express.static(publicDir, { extensions: ["html"] }));
  app.use((_req, res) => {
    res.status(404).sendFile(path.join(publicDir, "index.html"));
  });

  app.use(((err, req, res, _next) => {
    logger.error(err?.message ?? "unhandled error", {
      requestId: res.locals.requestId,
      route: `${req.method} ${req.path}`,
      stack: err?.stack,
    });
    res.status(500).json({ error: "Algo quebrou do lado de cá." });
  }) as express.ErrorRequestHandler);

  return app;
}
