import type { Request } from "express";

/** "METHOD /matched/:route", so /api/projects/:slug is one series, not one per slug. Static files collapse to "static". */
export function routeLabel(req: Request): string {
  const path = req.route?.path ? req.baseUrl + req.route.path : req.path.startsWith("/api") ? req.path : "static";
  return `${req.method} ${path}`;
}
