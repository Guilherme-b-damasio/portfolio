import express from "express";
import { z } from "zod";
import type { AskQuestion } from "../../application/ask-question.js";
import type { AskResult } from "../../domain/answer.js";
import type { BrowsePortfolio } from "../../application/browse-portfolio.js";
import type { BrowseTlsSamples } from "../../application/browse-tls-samples.js";
import type { DescribeCommands } from "../../application/describe-commands.js";
import type { InspectCluster } from "../../application/inspect-cluster.js";
import type { InspectVisitor } from "../../application/inspect-visitor.js";
import type { LoadLab } from "../../application/load-lab.js";
import type { ReportStatus } from "../../application/report-status.js";
import type { SendContact } from "../../application/send-contact.js";
import type { ShowEvals } from "../../application/show-evals.js";
import type { ShowTrace } from "../../application/show-trace.js";
import type { TraceDeploys } from "../../application/trace-deploys.js";
import type { ProbeNat } from "../../application/probe-nat.js";
import type { TestDnsLeak } from "../../application/test-dns-leak.js";
import type { TuneSearch } from "../../application/tune-search.js";
import type { Http2Connections } from "../../domain/http2.js";
import type { Logger } from "../../domain/logger.js";
import type { TappedConnections } from "../../domain/tls.js";
import { concurrencyCap, ConcurrencyGate } from "../middleware/concurrency.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";
import { openEventStream } from "../sse.js";
import { clusterRouter } from "./cluster.js";
import { contactRouter } from "./contact.js";
import { dnsLeakRouter } from "./dns-leak.js";
import { evalsRouter } from "./evals.js";
import { labRouter } from "./lab.js";
import { manRouter } from "./man.js";
import { loadLabRouter } from "./load-lab.js";
import { scanRouter } from "./scan.js";
import { searchLabRouter } from "./search-lab.js";
import { stunRouter } from "./stun.js";

export interface ApiDeps {
  browse: BrowsePortfolio;
  askQuestion: AskQuestion;
  reportStatus: ReportStatus;
  sendContact: SendContact;
  inspectVisitor: InspectVisitor;
  tapped?: TappedConnections | null; // set when the app also serves TLS itself
  tlsSamples?: BrowseTlsSamples | null;
  http2?: Http2Connections | null; // h2 prefaces read on that same TLS listener
  askLimit?: { capacity: number; refillPerMinute: number };
  askConcurrency?: number; // questions answered at once, across every visitor
  askTimeoutMs?: number; // generation is aborted past this, streamed or not
  showEvals?: ShowEvals | null; // the retrieval eval at /api/evals; off without an eval set
  showTrace?: ShowTrace | null; // finished traces at /api/traces/:id; off without a trace store
  inspectCluster?: InspectCluster | null; // /api/cluster; without one it answers that the cluster is off
  traceDeploys?: TraceDeploys | null; // /api/deploys; both of its sources are cached upstream
  tuneSearch?: TuneSearch | null; // the search playground at /api/lab/search; off without a tunable index
  loadLab?: LoadLab | null; // the load lab at /api/lab/load; one run at a time across every visitor
  testDnsLeak?: TestDnsLeak | null; // /api/dns-leak; off without a delegated zone
  probeNat?: ProbeNat | null; // /api/stun; off without the STUN sockets listening
  describeCommands?: DescribeCommands | null; // /api/man, the manual `man <cmd>` reads
}

// A follow-up carries the last turns from the browser. Capped here so a visitor cannot inflate the prompt.
export const MAX_TURNS = 3;
const turn = z.object({ question: z.string().trim().min(2).max(500), answer: z.string().max(1500) });
const askBody = z.object({
  question: z.string().trim().min(2).max(500),
  xray: z.boolean().optional(),
  history: z.array(turn).max(MAX_TURNS).optional(),
  // Unknown names are not an error: the use case answers with the local index and says why.
  engine: z
    .string()
    .regex(/^[a-z]{1,20}$/)
    .optional(),
});

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
  {
    browse,
    askQuestion,
    reportStatus,
    sendContact,
    inspectVisitor,
    tapped,
    tlsSamples,
    http2,
    askTimeoutMs = 60_000,
    showEvals,
    showTrace,
    inspectCluster,
    traceDeploys,
    tuneSearch,
    loadLab,
    testDnsLeak,
    probeNat,
    describeCommands,
  }: ApiDeps,
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

  // Which retrieval engines `ask --engine` can pick on this server.
  api.get("/ask/engines", (_req, res) => {
    res.json({ engines: askQuestion.engineNames });
  });

  // The gate runs first, so a visitor turned away because the server is busy keeps their token.
  api.post("/ask", concurrencyCap(askGate), rateLimit(askBucket), async (req, res, next) => {
    const parsed = askBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: `Envie { question } com 2 a 500 caracteres, um engine opcional e, num follow-up, no máximo ${MAX_TURNS} turnos em history.`,
      });
      return;
    }
    // A visitor who leaves or a generation that runs too long stops spending tokens right away.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error("ask timed out")), askTimeoutMs);
    res.once("close", () => {
      clearTimeout(timer);
      abort.abort();
    });
    const { question, xray, history, engine } = parsed.data;
    const logFallback = (result: AskResult) => {
      if (result.engineFallback)
        logger.info("ask fell back to the local index", {
          requestId: res.locals.requestId,
          engine,
          reason: result.engineFallback,
        });
      return result;
    };

    if (!req.get("accept")?.includes("text/event-stream")) {
      try {
        res.json(
          logFallback(
            await askQuestion.execute(question, {
              signal: abort.signal,
              xray,
              history,
              engine,
              trace: res.locals.trace,
            }),
          ),
        );
      } catch (err) {
        next(err);
      }
      return;
    }

    const stream = openEventStream(res);
    try {
      const result = await askQuestion.execute(question, {
        onPassages: (passages, retrievalMs) => stream.send("passages", { passages, retrievalMs }),
        onText: (delta) => stream.send("text", { delta }),
        signal: abort.signal,
        xray,
        history,
        engine,
        trace: res.locals.trace,
      });
      stream.send("done", logFallback(result));
    } catch (err) {
      // Once the stream is open the status is already 200, so failures travel as an event.
      if (!res.destroyed) {
        logger.error((err as Error)?.message ?? "ask stream failed", { requestId: res.locals.requestId });
        stream.send("error", { error: "A resposta foi interrompida do lado de cá." });
      }
    } finally {
      stream.end();
    }
  });

  api.get("/status", (_req, res) => {
    res.json(reportStatus.status());
  });

  api.get("/status/history", (_req, res) => {
    res.json(reportStatus.history());
  });

  // A finished request, step by step. Ids are random and only handed to whoever made the request.
  if (showTrace)
    api.get("/traces/:id", (req, res) => {
      const trace = showTrace.byId(req.params.id);
      if (!trace) {
        res.status(404).json({ error: "trace não encontrado: ele expira depois de algumas centenas de requisições" });
        return;
      }
      res.json(trace);
    });

  if (inspectCluster) api.use("/cluster", clusterRouter(inspectCluster));

  // commit → image → rollout → pod Ready. Always 200: each source says on its own whether it answered.
  api.get("/deploys", async (_req, res, next) => {
    if (!traceDeploys) {
      res.status(503).json({ error: "a linha do tempo de deploys está desligada neste servidor", off: true });
      return;
    }
    try {
      res.json({ ...(await traceDeploys.timeline()), readAt: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });
  api.use("/contact", contactRouter(sendContact, logger));
  if (tuneSearch) api.use("/lab/search", searchLabRouter(tuneSearch));
  if (loadLab) api.use("/lab/load", loadLabRouter(loadLab, logger));
  api.use("/lab", labRouter());
  if (showEvals) api.use("/evals", evalsRouter(showEvals));
  api.use("/dns-leak", dnsLeakRouter(testDnsLeak ?? null));
  api.use("/stun", stunRouter(probeNat ?? null));
  if (describeCommands) api.use("/man", manRouter(describeCommands));
  api.use("/scan", scanRouter(inspectVisitor, tapped ?? null, tlsSamples ?? null, http2 ?? null));

  return api;
}
