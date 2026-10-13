import express, { type Request } from "express";
import { z } from "zod";
import type { InspectVisitor } from "../../application/inspect-visitor.js";
import type { ClientProbe, Observation } from "../../domain/exposure.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";

// Everything the browser reports is bounded: short strings, short lists, sane numbers.
const text = (max = 200) => z.string().max(max);
const count = z.number().int().min(0).max(10_000);
const brand = z.object({ brand: text(60), version: text(40) });

const probeSchema = z.object({
  userAgent: text(400).optional(),
  platform: text(60).optional(),
  languages: z.array(text(35)).max(10).optional(),
  timezone: text(60).optional(),
  timezoneOffsetMinutes: z.number().int().min(-900).max(900).optional(),
  screen: z
    .object({
      width: count,
      height: count,
      pixelRatio: z.number().min(0).max(10),
      colorDepth: z.number().int().min(0).max(64),
    })
    .optional(),
  hardwareConcurrency: count.optional(),
  deviceMemory: z.number().min(0).max(1024).optional(),
  maxTouchPoints: count.optional(),
  webdriver: z.boolean().optional(),
  cookieEnabled: z.boolean().optional(),
  doNotTrack: z.boolean().optional(),
  globalPrivacyControl: z.boolean().optional(),
  pluginCount: count.optional(),
  webgl: z.object({ vendor: text(120).optional(), renderer: text(200).optional() }).optional(),
  canvasHash: z
    .string()
    .regex(/^[0-9a-f]{8,64}$/)
    .optional(),
  uaData: z
    .object({
      brands: z.array(brand).max(10).optional(),
      mobile: z.boolean().optional(),
      platform: text(40).optional(),
      platformVersion: text(40).optional(),
      architecture: text(20).optional(),
      model: text(80).optional(),
      fullVersionList: z.array(brand).max(10).optional(),
    })
    .optional(),
  webrtcCandidates: z.array(text(80)).max(12).optional(),
  connection: z
    .object({
      effectiveType: text(10).optional(),
      rttMs: z.number().min(0).max(60_000).optional(),
      downlinkMbps: z.number().min(0).max(100_000).optional(),
    })
    .optional(),
  mediaDevices: z.object({ audioinput: count, audiooutput: count, videoinput: count }).optional(),
});

function observe(req: Request): Observation {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return {
    ip: req.ip ?? req.socket.remoteAddress ?? "",
    headers,
    httpVersion: req.httpVersion,
    viaProxy: req.headers["x-forwarded-for"] != null,
  };
}

/**
 * GET scans the bare request (what curl or any script gives away); POST adds what the browser
 * reported about itself. Each scan is computed on the spot and answered; none is kept.
 */
export function scanRouter(inspectVisitor: InspectVisitor) {
  const router = express.Router();
  const bucket = new TokenBucket(10, 10); // a DNS lookup each: cheap, but not free

  router.use(rateLimit(bucket), (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/", async (req, res, next) => {
    try {
      res.json(await inspectVisitor.execute(observe(req), null));
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    const parsed = probeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Sonda inválida.", issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) });
      return;
    }
    try {
      res.json(await inspectVisitor.execute(observe(req), parsed.data satisfies ClientProbe));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
