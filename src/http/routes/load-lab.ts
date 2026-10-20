import express from "express";
import { z } from "zod";
import { LOAD_LIMITS, type LoadLab } from "../../application/load-lab.js";
import type { Logger } from "../../domain/logger.js";
import { LoadLabBusy } from "../../domain/load.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";
import { openEventStream } from "../sse.js";

// Three runs a minute per visitor; the shared runner and its line bound everyone together.
export const LOAD_LAB_CAPACITY = 3;
export const LOAD_LAB_REFILL_PER_MINUTE = 3;
export const LOAD_RUN_TIMEOUT_MS = 30_000;

/**
 * The load lab: POST a plan and watch it over SSE (`queued` while waiting, `start`, one `sample`
 * per request, then `done` with the percentiles). GET answers whether the runner is busy and how long the line is.
 */
export function loadLabRouter(
  lab: LoadLab,
  logger: Logger,
  { bucket = new TokenBucket(LOAD_LAB_CAPACITY, LOAD_LAB_REFILL_PER_MINUTE), timeoutMs = LOAD_RUN_TIMEOUT_MS } = {},
) {
  const router = express.Router();
  const names = lab.targetList.map((t) => t.name);
  const plan = z.object({
    target: z.string().refine((name) => names.includes(name)),
    requests: z.number().int().min(LOAD_LIMITS.requests.min).max(LOAD_LIMITS.requests.max),
    concurrency: z.number().int().min(LOAD_LIMITS.concurrency.min).max(LOAD_LIMITS.concurrency.max),
  });

  router.get("/", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(lab.state);
  });

  router.post("/", (req, res, next) => {
    // A full line is refused before spending the visitor's run.
    const { running, waiting } = lab.state;
    if (running && waiting >= LOAD_LIMITS.maxWaiting) {
      res.setHeader("Retry-After", 10);
      res.status(503).json({ error: "A fila do laboratório de carga está cheia. Tenta de novo em instantes." });
      return;
    }
    next();
  });

  router.post(
    "/",
    rateLimit(bucket, "Três corridas por minuto. Espera o Retry-After e dispara de novo."),
    async (req, res) => {
      const parsed = plan.safeParse(req.body);
      if (!parsed.success) {
        const { requests, concurrency } = LOAD_LIMITS;
        res.status(400).json({
          error: `Envie { target, requests, concurrency }: target um de ${names.join(", ")}, requests de ${requests.min} a ${requests.max} e concurrency de ${concurrency.min} a ${concurrency.max}.`,
        });
        return;
      }

      // Leaving the page gives up the place in line or stops the run; nothing runs past the timeout.
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(new Error("load run timed out")), timeoutMs);
      res.once("close", () => {
        clearTimeout(timer);
        abort.abort(new Error("visitor left"));
      });

      const stream = openEventStream(res);
      try {
        const summary = await lab.run(
          parsed.data,
          {
            onQueued: (position) => stream.send("queued", { position }),
            onStart: (started) => stream.send("start", started),
            onSample: (sample) => stream.send("sample", sample),
          },
          abort.signal,
        );
        stream.send("done", { ...summary, timedOut: abort.signal.aborted && !res.destroyed });
      } catch (err) {
        if (!res.destroyed) {
          if (!(err instanceof LoadLabBusy))
            logger.error((err as Error)?.message ?? "load run failed", { requestId: res.locals.requestId });
          stream.send("error", {
            error: err instanceof LoadLabBusy ? err.message : "A corrida foi interrompida do lado de cá.",
          });
        }
      } finally {
        clearTimeout(timer);
        stream.end();
      }
    },
  );

  return router;
}
