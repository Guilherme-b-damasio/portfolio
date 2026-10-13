import express from "express";
import { z } from "zod";
import type { AskQuestion } from "../../application/ask-question.js";
import type { BrowsePortfolio } from "../../application/browse-portfolio.js";
import type { InspectVisitor } from "../../application/inspect-visitor.js";
import type { ReportStatus } from "../../application/report-status.js";
import type { SendContact } from "../../application/send-contact.js";
import type { Logger } from "../../domain/logger.js";
import type { TlsFingerprintSource } from "../../domain/tls.js";
import { concurrencyCap, ConcurrencyGate } from "../middleware/concurrency.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";
import { contactRouter } from "./contact.js";
import { scanRouter } from "./scan.js";

export interface ApiDeps {
  browse: BrowsePortfolio;
  askQuestion: AskQuestion;
  reportStatus: ReportStatus;
  sendContact: SendContact;
  inspectVisitor: InspectVisitor;
  tlsFingerprints?: TlsFingerprintSource | null; // set when the app also serves TLS itself
  askLimit?: { capacity: number; refillPerMinute: number };
  askConcurrency?: number; // questions answered at once, across every visitor
}

const askBody = z.object({ question: z.string().trim().min(2).max(500) });

/** The ask bucket is shared with the MCP `ask` tool, so both doors spend the same questions. */
export function askBucketFor({ askLimit }: Pick<ApiDeps, "askLimit">): TokenBucket {
  const { capacity, refillPerMinute } = askLimit ?? { capacity: 5, refillPerMinute: 5 };
  return new TokenBucket(capacity, refillPerMinute);
}

/** Both limits on asking, shared by every door that reaches the RAG (HTTP and MCP). */
export interface AskGuards {
  bucket: TokenBucket;
  gate: ConcurrencyGate;
}

export function askGuardsFor(deps: Pick<ApiDeps, "askLimit" | "askConcurrency">): AskGuards {
  return { bucket: askBucketFor(deps), gate: new ConcurrencyGate(deps.askConcurrency ?? 4) };
}

export function apiRouter(
  { browse, askQuestion, reportStatus, sendContact, inspectVisitor, tlsFingerprints }: ApiDeps,
  logger: Logger,
  { bucket: askBucket, gate: askGate }: AskGuards,
) {
  const api = express.Router();

  api.get("/profile", (_req, res) => {
    res.json(browse.profile());
  });

  api.get("/skills", (_req, res) => {
    res.json(browse.skills());
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

  // The gate runs first, so a visitor turned away because the server is busy keeps their token.
  api.post("/ask", concurrencyCap(askGate), rateLimit(askBucket), async (req, res, next) => {
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

  api.use("/contact", contactRouter(sendContact, logger));
  api.use("/scan", scanRouter(inspectVisitor, tlsFingerprints ?? null));

  return api;
}
