import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

// A caller-supplied id is kept only if it is short and plain, so it is safe to log and echo back.
const VALID_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Reuses an incoming `x-request-id` (e.g. from Traefik) or creates one, and echoes it in the response. */
export function requestId(newId: () => string = randomUUID): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get("x-request-id");
    const id = incoming && VALID_ID.test(incoming) ? incoming : newId();
    res.locals.requestId = id;
    res.setHeader("x-request-id", id);
    next();
  };
}
