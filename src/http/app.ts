import path from "node:path";
import express from "express";
import type { MetricsStore } from "../domain/metrics.js";
import { recordMetrics } from "./middleware/metrics.js";
import { apiRouter, type ApiDeps } from "./routes/api.js";

export interface AppDeps extends ApiDeps {
  metrics: MetricsStore;
  publicDir: string;
}

export function createApp({ metrics, publicDir, ...apiDeps }: AppDeps) {
  const app = express();
  app.set("trust proxy", 1); // behind Traefik in k3s, so req.ip is the real client
  app.disable("x-powered-by");
  app.use(recordMetrics(metrics));
  app.use(express.json({ limit: "4kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4").send(apiDeps.reportStatus.prometheus());
  });

  app.use("/api", apiRouter(apiDeps));
  app.use(express.static(publicDir, { extensions: ["html"] }));
  app.use((_req, res) => {
    res.status(404).sendFile(path.join(publicDir, "index.html"));
  });

  app.use(((err, _req, res, _next) => {
    console.error(JSON.stringify({ level: "error", msg: err?.message, stack: err?.stack }));
    res.status(500).json({ error: "Algo quebrou do lado de cá." });
  }) as express.ErrorRequestHandler);

  return app;
}
