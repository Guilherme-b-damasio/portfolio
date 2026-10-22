import express from "express";
import { z } from "zod";
import type { ProbeNat } from "../../application/probe-nat.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";

// What the browser read off its own ICE candidates: an address and a port, a handful at most.
const candidates = z
  .array(
    z.object({
      address: z
        .string()
        .trim()
        .max(45)
        .regex(/^[0-9a-f.:]+$/i),
      port: z.number().int().min(1).max(65_535),
    }),
  )
  .max(8);

/**
 * GET reads what the STUN sockets saw coming from this visitor's address; POST adds what the
 * browser says it was answered, which only ever gets compared with that address, never looked up.
 */
export function stunRouter(probeNat: ProbeNat | null, reads = new TokenBucket(30, 30)) {
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (probeNat) return next();
    res.status(503).json({ error: "o teste de STUN está desligado neste servidor", off: true });
  });

  const limit = rateLimit(reads, "Leituras demais seguidas. Tenta de novo em instantes.");

  router.get("/", limit, (req, res) => {
    res.json(probeNat!.report(req.ip ?? ""));
  });

  router.post("/", limit, (req, res) => {
    const parsed = candidates.safeParse(req.body?.candidates ?? []);
    if (!parsed.success) {
      res.status(400).json({ error: "candidatos inválidos" });
      return;
    }
    res.json(probeNat!.report(req.ip ?? "", parsed.data));
  });

  return router;
}
