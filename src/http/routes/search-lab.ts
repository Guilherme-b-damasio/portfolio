import express from "express";
import { z } from "zod";
import { TUNING_LIMITS, type TuneSearch } from "../../application/tune-search.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";

// A slider fires a search per step, so the bucket is roomy; each one is a sub-millisecond pass over a small index.
export const SEARCH_LAB_CAPACITY = 60;
export const SEARCH_LAB_REFILL_PER_MINUTE = 120;

const number = (min: number, max: number) => z.coerce.number().min(min).max(max);
const tuning = z.object({
  q: z.string().trim().min(2).max(200),
  k1: number(TUNING_LIMITS.k1.min, TUNING_LIMITS.k1.max).optional(),
  b: number(TUNING_LIMITS.b.min, TUNING_LIMITS.b.max).optional(),
  k: number(TUNING_LIMITS.k.min, TUNING_LIMITS.k.max).int().optional(),
});

/** The search playground: GET ?q=&k1=&b=&k= ranks the chat's own BM25 index with the visitor's parameters. */
export function searchLabRouter(
  tuneSearch: TuneSearch,
  bucket = new TokenBucket(SEARCH_LAB_CAPACITY, SEARCH_LAB_REFILL_PER_MINUTE),
) {
  const router = express.Router();

  // The sliders' ranges and the server's own parameters, to draw the controls before the first search.
  router.get("/params", (_req, res) => {
    res.json({ limits: TUNING_LIMITS, defaults: tuneSearch.defaults });
  });

  router.get(
    "/",
    rateLimit(bucket, "Os sliders estão rápidos demais: o balde da busca esvaziou. Espera o Retry-After."),
    (req, res) => {
      const parsed = tuning.safeParse(req.query);
      if (!parsed.success) {
        const { k1, b, k } = TUNING_LIMITS;
        res.status(400).json({
          error: `Envie q com 2 a 200 caracteres; k1 de ${k1.min} a ${k1.max}, b de ${b.min} a ${b.max} e k inteiro de ${k.min} a ${k.max}.`,
        });
        return;
      }
      const { q, ...params } = parsed.data;
      const defaults = tuneSearch.defaults;
      res.json(
        tuneSearch.run(q, { k1: params.k1 ?? defaults.k1, b: params.b ?? defaults.b, k: params.k ?? defaults.k }),
      );
    },
  );

  return router;
}
