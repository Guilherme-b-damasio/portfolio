import type { Response } from "express";

/**
 * Turns a response into a server-sent event stream. Proxies are told not to buffer it, so each
 * event leaves as soon as it is written.
 */
export function openEventStream(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  return {
    send(event: string, data: unknown) {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!res.writableEnded) res.end();
    },
  };
}
