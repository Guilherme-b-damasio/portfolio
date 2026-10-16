import type { RequestHandler } from "express";
import type { TraceStore } from "../../domain/tracing.js";
import { routeLabel } from "../route-label.js";

/**
 * Opens a trace for every API and MCP request, hands it to the route in `res.locals.trace` and names it
 * in `x-trace-id`. Static files are left out so they never push real requests out of the buffer, and so
 * are the trace lookups themselves.
 */
export function tracing(traces: TraceStore, prefixes = ["/api", "/mcp"], skip = ["/api/traces"]): RequestHandler {
  const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  return (req, res, next) => {
    if (!prefixes.some((p) => under(req.path, p)) || skip.some((p) => under(req.path, p))) return next();
    const trace = traces.start();
    res.locals.trace = trace;
    res.setHeader("x-trace-id", trace.id);
    // "close" also fires when the visitor leaves mid-stream, so an aborted answer is still traced.
    res.once("close", () => trace.end(routeLabel(req), res.statusCode));
    next();
  };
}
