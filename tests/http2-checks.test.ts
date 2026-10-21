import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { ReportStatus } from "../src/application/report-status.js";
import { Http2StackCheck } from "../src/application/scan/checks/http2.js";
import { scanChecks } from "../src/application/scan/checks/index.js";
import { classifyHttp2 } from "../src/application/scan/http2-stack.js";
import { parseUserAgent } from "../src/application/scan/user-agent.js";
import { SendContact } from "../src/application/send-contact.js";
import type { ScanContext } from "../src/domain/exposure.js";
import type { Http2Fingerprint, Http2Preface } from "../src/domain/http2.js";
import { createApp } from "../src/http/app.js";
import { http2Fingerprint } from "../src/infrastructure/http2/akamai.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";
import { UA } from "./fixtures/user-agents.js";

// Prefaces as each client sends them (settings, window update, pseudo-header order), per public fingerprint databases.
const preface = (settings: [number, number][], windowUpdate: number | null, pseudo: string): Http2Preface => ({
  settings: settings.map(([id, value]) => ({ id, name: String(id), value })),
  windowUpdate,
  priorities: [],
  headerPriority: null,
  pseudoHeaders: pseudo.split(",").map((c) => ({ m: ":method", a: ":authority", s: ":scheme", p: ":path" })[c]!),
  frames: [],
  bytes: 0,
});
const chrome = http2Fingerprint(
  preface(
    [
      [1, 65536],
      [2, 0],
      [4, 6291456],
      [6, 262144],
    ],
    15663105,
    "m,a,s,p",
  ),
);
const firefox = http2Fingerprint(
  preface(
    [
      [1, 65536],
      [2, 0],
      [4, 131072],
      [5, 16384],
    ],
    12517377,
    "m,p,a,s",
  ),
);
const safari = http2Fingerprint(
  preface(
    [
      [2, 0],
      [3, 100],
      [4, 2097152],
      [9, 1],
    ],
    10420225,
    "m,s,a,p",
  ),
);
const curl = http2Fingerprint(
  preface(
    [
      [3, 100],
      [4, 10485760],
      [2, 0],
    ],
    1048510465,
    "m,p,s,a",
  ),
);
// httpx and Go copy Chrome's order but not its window.
const httpx = http2Fingerprint(preface([[4, 65535]], null, "m,a,s,p"));

function ctx(ua: string, http2: Http2Fingerprint | null): ScanContext {
  return {
    observation: {
      ip: "200.150.1.2",
      headers: { "user-agent": ua },
      httpVersion: "2.0",
      viaProxy: false,
      tls: null,
      headerOrder: null,
      http2,
    },
    probe: null,
    claimed: parseUserAgent(ua),
    reverseDns: null,
    now: new Date(Date.UTC(2026, 9, 20)),
  };
}
const verdicts = (ua: string, fp: Http2Fingerprint | null) =>
  new Http2StackCheck().run(ctx(ua, fp)).map((f) => f.verdict);

describe("HTTP/2 stack", () => {
  it("tells clients apart by pseudo-header order and initial window", () => {
    expect(classifyHttp2(chrome.preface).family).toBe("chromium");
    expect(classifyHttp2(firefox.preface).family).toBe("firefox");
    expect(classifyHttp2(safari.preface).family).toBe("apple");
    expect(classifyHttp2(curl.preface).family).toBe("curl");
    expect(classifyHttp2(httpx.preface).family).toBe("desconhecida");
  });

  it("confirms each browser that is what it says", () => {
    expect(verdicts(UA.chromeWin, chrome)).toEqual(["ok"]);
    expect(verdicts(UA.edgeWin, chrome)).toEqual(["ok"]);
    expect(verdicts(UA.firefoxLinux, firefox)).toEqual(["ok"]);
    expect(verdicts(UA.safariMac, safari)).toEqual(["ok"]);
    expect(verdicts(UA.safariIphone, safari)).toEqual(["ok"]);
  });

  it("unmasks curl wearing a Chrome User-Agent", () => {
    const [finding] = new Http2StackCheck().run(ctx(UA.chromeWin, curl));
    expect(finding.verdict).toBe("contradicao");
    expect(finding.title).toContain("curl");
    expect(finding.evidence[0]).toBe(`Akamai: ${curl.akamai}`);
  });

  it("only raises an eyebrow at an HTTP/2 stack it doesn't know", () => {
    expect(verdicts(UA.chromeWin, httpx)).toEqual(["info"]);
    expect(verdicts(UA.firefoxLinux, chrome)).toEqual(["contradicao"]);
  });

  it("describes an honest tool and stays quiet over HTTP/1.1", () => {
    expect(verdicts(UA.curl, curl)).toEqual(["info"]);
    expect(verdicts(UA.chromeWin, null)).toEqual([]);
  });
});

describe("/api/scan over h2", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const metrics = new InMemoryMetrics();
    const app = createApp({
      browse: new BrowsePortfolio({
        profile: { name: "N", handle: "n", role: "r", links: {}, body: "" },
        projects: [],
        skills: [],
      }),
      askQuestion: new AskQuestion({ search: () => [] }, null),
      reportStatus: new ReportStatus(metrics, null, new SampledHistory(metrics)),
      sendContact: new SendContact(null),
      inspectVisitor: new InspectVisitor(scanChecks(), { lookup: async () => null }),
      // As if every connection had opened with Chrome's preface on the TLS listener.
      http2: { http2: () => chrome },
      metrics,
      logger: { info: () => {}, error: () => {} },
      publicDir: path.join(import.meta.dirname, "..", "public"),
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("reports the h2 fingerprint and leaves out the bridge's Connection header", async () => {
    const report = await (await fetch(`${base}/api/scan`, { headers: { "user-agent": UA.chromeWin } })).json();
    const signal = (label: string) => report.signals.find((s: { label: string }) => s.label === label)?.value;
    expect(signal("HTTP/2 (Akamai)")).toBe(chrome.akamai);
    expect(signal("pilha h2 provável")).toContain("Chromium");
    expect(signal("pseudo-headers")).toBe(":method → :authority → :scheme → :path");
    expect(signal("ordem dos cabeçalhos")).not.toContain("connection");
    expect(report.findings).toContainEqual(expect.objectContaining({ id: "http2-stack", verdict: "ok" }));
  });
});
