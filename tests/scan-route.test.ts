import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { ReportStatus } from "../src/application/report-status.js";
import { scanChecks } from "../src/application/scan/checks/index.js";
import { SendContact } from "../src/application/send-contact.js";
import type { Content } from "../src/domain/content.js";
import { createApp } from "../src/http/app.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";
import { UA } from "./fixtures/user-agents.js";

const root = path.resolve(import.meta.dirname, "..");

describe("/api/scan", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const content: Content = {
      profile: { name: "N", handle: "n", role: "r", links: {}, body: "" },
      projects: [],
      skills: [],
    };
    const metrics = new InMemoryMetrics();
    const app = createApp({
      browse: new BrowsePortfolio(content),
      askQuestion: new AskQuestion({ search: () => [] }, null),
      reportStatus: new ReportStatus(metrics, null, new SampledHistory(metrics)),
      sendContact: new SendContact(null),
      inspectVisitor: new InspectVisitor(scanChecks(), { lookup: async () => null }),
      metrics,
      logger: { info: () => {}, error: () => {} },
      publicDir: path.join(root, "public"),
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const scan = (headers: Record<string, string>, probe?: unknown) =>
    fetch(`${base}/api/scan`, {
      method: probe === undefined ? "GET" : "POST",
      headers: { ...headers, ...(probe === undefined ? {} : { "content-type": "application/json" }) },
      body: probe === undefined ? undefined : JSON.stringify(probe),
    });

  it("names the tool behind a bare GET and is never cached", async () => {
    const res = await scan({ "user-agent": UA.curl });
    const report = await res.json();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(report.claimed.tool).toBe("curl");
    expect(report.findings[0]).toMatchObject({ id: "tool", verdict: "exposto" });
    expect(report.summary.probe).toBe(false);
  });

  it("catches a spoofed browser across layers", async () => {
    // A Chromium on Windows wearing an iPhone User-Agent, with its clock left in Brazil.
    const res = await scan(
      {
        "user-agent": UA.safariIphone,
        "sec-ch-ua": '"Google Chrome";v="153", "Chromium";v="153"',
        "accept-language": "pt-BR",
      },
      {
        userAgent: UA.safariIphone,
        platform: "Win32",
        languages: ["pt-BR"],
        timezone: "Europe/Berlin",
        timezoneOffsetMinutes: -180,
        webgl: { renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
        webrtcCandidates: ["192.168.0.12"],
      },
    );
    const report = await res.json();
    const contradictions = report.findings.filter((f: { verdict: string }) => f.verdict === "contradicao");
    expect(contradictions.map((f: { id: string }) => f.id)).toEqual(
      expect.arrayContaining(["client-hints-engine", "platform", "gpu-os", "timezone"]),
    );
    expect(report.summary.contradictions).toBe(contradictions.length);
    expect(report.findings.map((f: { id: string }) => f.id)).toContain("webrtc-local");
  });

  it("rejects an oversized or malformed probe", async () => {
    expect((await scan({}, { languages: Array(50).fill("pt") })).status).toBe(400);
    expect((await scan({}, { canvasHash: "<script>" })).status).toBe(400);
  });

  it("rate limits scans per visitor", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await scan({ "user-agent": UA.curl })).status);
    expect(statuses).toContain(429);
  });
});
