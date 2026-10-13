import express from "express";
import { z } from "zod";
import type { AskQuestion } from "../../application/ask-question.js";
import type { BrowsePortfolio } from "../../application/browse-portfolio.js";
import type { ReportStatus } from "../../application/report-status.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";

export interface ApiDeps {
  browse: BrowsePortfolio;
  askQuestion: AskQuestion;
  reportStatus: ReportStatus;
  askLimit?: { capacity: number; refillPerMinute: number };
}

const askBody = z.object({ question: z.string().trim().min(2).max(500) });

export function apiRouter({ browse, askQuestion, reportStatus, askLimit }: ApiDeps) {
  const api = express.Router();
  const { capacity, refillPerMinute } = askLimit ?? { capacity: 5, refillPerMinute: 5 };
  const askBucket = new TokenBucket(capacity, refillPerMinute);

  api.get("/profile", (_req, res) => {
    res.json(browse.profile());
  });

  api.get("/projects", (req, res) => {
    const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
    res.json(browse.projects(tag));
  });

  api.get("/projects/:slug", (req, res) => {
    const project = browse.project(req.params.slug);
    if (!project) {
      res.status(404).json({ error: `projeto '${req.params.slug}' não existe` });
      return;
    }
    res.json(project);
  });

  // The visitor's balance without spending a token: drives the bucket in the terminal header.
  api.get("/ask/quota", (req, res) => {
    res.json(askBucket.peek(req.ip ?? "unknown"));
  });

  api.post("/ask", rateLimit(askBucket), async (req, res, next) => {
    const parsed = askBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Envie { question: string } com 2 a 500 caracteres." });
      return;
    }
    try {
      res.json(await askQuestion.execute(parsed.data.question));
    } catch (err) {
      next(err);
    }
  });

  api.get("/status", (_req, res) => {
    res.json(reportStatus.status());
  });

  api.get("/status/history", (_req, res) => {
    res.json(reportStatus.history());
  });

  return api;
}
