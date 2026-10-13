import express from "express";
import { z } from "zod";
import { ContactBudgetError, type SendContact } from "../../application/send-contact.js";
import type { Logger } from "../../domain/logger.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";

const PER_HOUR = 3;

// One line, no control characters: the name ends up in the e-mail subject.
const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => ![...s].some((c) => c.charCodeAt(0) < 32));

const contactBody = z.object({
  reason: z.enum(["vaga", "projeto", "conversa"]),
  name: singleLine(100),
  email: z.string().trim().email().max(200),
  message: z.string().trim().min(20).max(1000),
  website: z.string().max(200).optional(), // honeypot: people never see it, bots fill it
});

export function contactRouter(sendContact: SendContact, logger: Logger) {
  const router = express.Router();
  const bucket = new TokenBucket(PER_HOUR, PER_HOUR / 60);

  // Lets the page hide the form when no mailer is configured.
  router.get("/", (_req, res) => {
    res.json({ enabled: sendContact.enabled, perHour: PER_HOUR });
  });

  router.post("/", (req, res, next) => {
    if (!sendContact.enabled) {
      res.status(503).json({ error: "O formulário está desligado. Use o e-mail ao lado." });
      return;
    }
    next();
  });

  // Validation runs before the limit, so a typo doesn't cost the visitor one of the hourly sends.
  router.post("/", (req, res, next) => {
    const parsed = contactBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Confira nome, e-mail e uma mensagem de 20 a 1000 caracteres." });
      return;
    }
    res.locals.contact = parsed.data;
    next();
  });

  router.post("/", rateLimit(bucket), async (_req, res, next) => {
    const { website, ...message } = res.locals.contact as z.infer<typeof contactBody>;
    if (website) {
      // Pretend it worked so the bot moves on, but send nothing.
      res.status(202).json({ id: "msg_ignored" });
      return;
    }
    try {
      const { id } = await sendContact.execute(message);
      logger.info("contact sent", { requestId: res.locals.requestId, id, reason: message.reason });
      res.status(202).json({ id });
    } catch (err) {
      if (err instanceof ContactBudgetError) {
        res.status(503).json({ error: "Muitas mensagens hoje. Tente amanhã ou use o e-mail ao lado." });
        return;
      }
      next(err);
    }
  });

  return router;
}
