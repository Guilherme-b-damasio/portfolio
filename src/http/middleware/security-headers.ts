import type { RequestHandler } from "express";

// Scripts and styles only from this origin: no inline code, no eval. Google Fonts is the one
// third party, for the stylesheet and the font files it points to.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  // TLS ends at Traefik, so the browser only honours this when the site is served over https.
  "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
};

/** Sets the same security headers on every response, API and static files alike. */
export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    for (const [name, value] of Object.entries(HEADERS)) res.setHeader(name, value);
    next();
  };
}
