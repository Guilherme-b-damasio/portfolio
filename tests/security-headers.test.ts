import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  contentSecurityPolicy,
  securityHeaders,
} from "../src/http/middleware/security-headers.js";

const root = path.resolve(import.meta.dirname, "..");

describe("security headers", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(securityHeaders());
    app.get("/api/thing", (_req, res) => {
      res.json({ ok: true });
    });
    app.use(express.static(path.join(root, "public")));
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("sets them on api responses and static files alike", async () => {
    for (const url of [`${base}/api/thing`, `${base}/`, `${base}/app.js`]) {
      const { headers } = await fetch(url);
      expect(headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("x-frame-options")).toBe("DENY");
      expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(headers.get("strict-transport-security")).toMatch(/^max-age=\d+/);
    }
  });

  it("never allows inline or evaluated scripts", () => {
    const scriptSrc = CONTENT_SECURITY_POLICY.split("; ").find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });

  it("adds the DNS leak zone to images only, scripts stay on this origin", () => {
    const policy = contentSecurityPolicy(["https://*.leak.example.test"]);
    expect(policy).toContain("img-src 'self' data: https://*.leak.example.test;");
    expect(policy.split("; ").find((d) => d.startsWith("script-src"))).toBe("script-src 'self'");
    expect(policy.split("; ").find((d) => d.startsWith("connect-src"))).toBe("connect-src 'self'");
    expect(contentSecurityPolicy()).toBe(CONTENT_SECURITY_POLICY);
  });

  it("matches the page: no inline scripts, handlers or style attributes", async () => {
    const html = await readFile(path.join(root, "public", "index.html"), "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\bsrc="\//);
      expect(body.trim()).toBe("");
    }
    expect(html).not.toMatch(/\son[a-z]+="/);
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/<style\b/);
  });
});
