import path from "node:path";
import express from "express";
import { z } from "zod";
import { ask, type Answerer } from "./ask.js";
import type { Content } from "./content.js";
import { Metrics } from "./metrics.js";
import { rateLimit } from "./rate-limit.js";
import type { Retriever } from "./search.js";

export interface AppDeps {
  content: Content;
  retriever: Retriever;
  answerer: Answerer | null;
  publicDir: string;
  metrics?: Metrics;
  askLimit?: { capacity: number; refillPerMinute: number };
}

const askBody = z.object({ question: z.string().trim().min(2).max(500) });

export function createApp({ content, retriever, answerer, publicDir, metrics = new Metrics(), askLimit }: AppDeps) {
  const app = express();
  app.set("trust proxy", 1); // behind Traefik in k3s, so req.ip is the real client
  app.disable("x-powered-by");
  app.use(metrics.middleware());
  app.use(express.json({ limit: "4kb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/metrics", (_req, res) => {
    res.type("text/plain; version=0.0.4").send(metrics.prometheus());
  });

  const api = express.Router();

  api.get("/profile", (_req, res) => {
    res.json(content.profile);
  });

  api.get("/projects", (req, res) => {
    const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
    const projects = content.projects
      .filter((p) => !tag || p.tags.includes(tag))
      .map(({ body: _body, ...summary }) => summary);
    res.json(projects);
  });

  api.get("/projects/:slug", (req, res) => {
    const project = content.projects.find((p) => p.slug === req.params.slug);
    if (!project) {
      res.status(404).json({ error: `projeto '${req.params.slug}' não existe` });
      return;
    }
    res.json(project);
  });

  api.post("/ask", rateLimit(askLimit ?? { capacity: 5, refillPerMinute: 5 }), async (req, res, next) => {
    const parsed = askBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Envie { question: string } com 2 a 500 caracteres." });
      return;
    }
    try {
      res.json(await ask(parsed.data.question, retriever, answerer));
    } catch (err) {
      next(err);
    }
  });

  api.get("/status", (_req, res) => {
    res.json({ ...metrics.snapshot(), llm: answerer ? answerer.model : null });
  });

  app.use("/api", api);
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
