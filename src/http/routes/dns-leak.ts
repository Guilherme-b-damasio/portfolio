import express from "express";
import type { TestDnsLeak } from "../../application/test-dns-leak.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";

const TOKEN = /^[0-9a-f]{16}$/i;

/**
 * POST hands out a fresh name to resolve; GET reads who asked for it. A name is good for a few
 * minutes, and only whoever got it can read it back: the token is the only key.
 */
export function dnsLeakRouter(
  testDnsLeak: TestDnsLeak | null,
  starts = new TokenBucket(6, 6),
  reads = new TokenBucket(30, 30), // the page polls a few times per test; each read does a few PTR lookups
) {
  const router = express.Router();

  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (testDnsLeak) return next();
    res.status(503).json({ error: "o teste de DNS está desligado neste servidor", off: true });
  });

  router.post("/", rateLimit(starts, "Muitos testes de DNS seguidos. Tenta de novo em instantes."), (_req, res) => {
    const probe = testDnsLeak!.start();
    if (!probe) {
      res.setHeader("Retry-After", 30);
      res.status(503).json({ error: "Muitos testes em andamento agora. Tenta de novo em instantes." });
      return;
    }
    res.status(201).json(probe);
  });

  router.get(
    "/:token",
    rateLimit(reads, "Leituras demais seguidas. Tenta de novo em instantes."),
    async (req, res, next) => {
      const token = String(req.params.token);
      if (!TOKEN.test(token)) {
        res.status(400).json({ error: "token inválido" });
        return;
      }
      try {
        const report = await testDnsLeak!.report(token, req.ip ?? "");
        if (!report) {
          res.status(404).json({ error: "teste não encontrado: ele expira em poucos minutos" });
          return;
        }
        res.json(report);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
