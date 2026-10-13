import { describe, expect, it } from "vitest";
import {
  AutomationCheck,
  expectedStable,
  FingerprintSurfaceCheck,
  GpuCheck,
  OutdatedBrowserCheck,
  PlatformCheck,
  TimezoneCheck,
  UserAgentLayersCheck,
  zoneOffsetMinutes,
} from "../src/application/scan/checks/browser.js";
import {
  ClientHintsCheck,
  LanguageCheck,
  parseBrands,
  PrivacySignalCheck,
  ToolClientCheck,
} from "../src/application/scan/checks/http.js";
import { ReverseDnsCheck, WebRtcLeakCheck } from "../src/application/scan/checks/network.js";
import { parseUserAgent } from "../src/application/scan/user-agent.js";
import type { ClientProbe, ExposureCheck, ScanContext, Verdict } from "../src/domain/exposure.js";
import { UA } from "./fixtures/user-agents.js";

const NOW = new Date(Date.UTC(2026, 9, 13, 15));

function ctx(ua: string, headers: Record<string, string> = {}, probe: ClientProbe | null = null): ScanContext {
  return {
    observation: {
      ip: "200.150.1.2",
      headers: { "user-agent": ua, ...headers },
      httpVersion: "1.1",
      viaProxy: true,
      tls: null,
      headerOrder: null,
    },
    probe,
    claimed: parseUserAgent(ua),
    reverseDns: null,
    now: NOW,
  };
}

const verdicts = (check: ExposureCheck, c: ScanContext): Verdict[] => check.run(c).map((f) => f.verdict);
const ids = (check: ExposureCheck, c: ScanContext) => check.run(c).map((f) => f.id);

describe("http checks", () => {
  it("flags client libraries", () => {
    expect(verdicts(new ToolClientCheck(), ctx(UA.curl))).toEqual(["exposto"]);
    expect(new ToolClientCheck().run(ctx(UA.chromeWin))).toEqual([]);
  });

  it("drops GREASE brands from Sec-CH-UA", () => {
    expect(parseBrands('"Chromium";v="153", "Google Chrome";v="153", "Not?A_Brand";v="99"')).toEqual([
      { brand: "Chromium", version: "153" },
      { brand: "Google Chrome", version: "153" },
    ]);
  });

  it("accepts Client Hints that match the User-Agent", () => {
    const c = ctx(UA.edgeWin, {
      "sec-ch-ua": '"Microsoft Edge";v="153", "Chromium";v="153", "Not)A;Brand";v="24"',
      "sec-ch-ua-platform": '"Windows"',
    });
    expect(verdicts(new ClientHintsCheck(), c)).toEqual(["ok"]);
  });

  it("catches a Chromium pretending to be Firefox", () => {
    const c = ctx(UA.firefoxLinux, { "sec-ch-ua": '"Google Chrome";v="153", "Chromium";v="153"' });
    expect(ids(new ClientHintsCheck(), c)).toContain("client-hints-engine");
  });

  it("catches a version or platform edited in one layer only", () => {
    const version = ctx(UA.chromeWin, { "sec-ch-ua": '"Google Chrome";v="150", "Chromium";v="150"' });
    expect(ids(new ClientHintsCheck(), version)).toContain("client-hints-version");
    const platform = ctx(UA.chromeWin, {
      "sec-ch-ua": '"Google Chrome";v="153", "Chromium";v="153"',
      "sec-ch-ua-platform": '"macOS"',
    });
    expect(ids(new ClientHintsCheck(), platform)).toContain("client-hints-platform");
  });

  it("reveals what the frozen User-Agent hides", () => {
    const c = ctx(UA.chromeAndroid, {}, { uaData: { platform: "Android", model: "SM-S918B" } });
    expect(ids(new ClientHintsCheck(), c)).toContain("client-hints-model");
    const win = ctx(UA.chromeWin, {}, { uaData: { platform: "Windows", platformVersion: "19.0.0" } });
    expect(ids(new ClientHintsCheck(), win)).toContain("client-hints-windows11");
  });

  it("compares the header language with the browser's", () => {
    const same = ctx(UA.chromeWin, { "accept-language": "pt-BR,pt;q=0.9" }, { languages: ["pt-BR", "en"] });
    expect(new LanguageCheck().run(same)).toEqual([]);
    const spoofed = ctx(UA.chromeWin, { "accept-language": "en-US,en;q=0.9" }, { languages: ["pt-BR"] });
    expect(verdicts(new LanguageCheck(), spoofed)).toEqual(["contradicao"]);
  });

  it("reads the Global Privacy Control signal", () => {
    expect(verdicts(new PrivacySignalCheck(), ctx(UA.firefoxLinux, { "sec-gpc": "1" }))).toEqual(["ok"]);
    expect(verdicts(new PrivacySignalCheck(), ctx(UA.chromeWin))).toEqual(["info"]);
  });
});

describe("browser checks", () => {
  it("spots a User-Agent rewritten in one layer only", () => {
    expect(new UserAgentLayersCheck().run(ctx(UA.chromeWin, {}, { userAgent: UA.chromeWin }))).toEqual([]);
    expect(verdicts(new UserAgentLayersCheck(), ctx(UA.chromeWin, {}, { userAgent: UA.safariIphone }))).toEqual([
      "contradicao",
    ]);
  });

  it("checks the claimed OS against the platform APIs", () => {
    expect(new PlatformCheck().run(ctx(UA.chromeAndroid, {}, { platform: "Linux armv8l" }))).toEqual([]);
    const spoofed = new PlatformCheck().run(ctx(UA.safariIphone, {}, { platform: "Win32" }));
    expect(spoofed[0]).toMatchObject({ verdict: "contradicao", title: expect.stringContaining("Windows") });
  });

  it("knows which GPUs exist on which systems", () => {
    const nvidia = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";
    expect(verdicts(new GpuCheck(), ctx(UA.chromeWin, {}, { webgl: { renderer: nvidia } }))).toEqual(["exposto"]);
    expect(ids(new GpuCheck(), ctx(UA.safariIphone, {}, { webgl: { renderer: nvidia } }))).toContain("gpu-os");
    expect(verdicts(new GpuCheck(), ctx(UA.safariIphone, {}, { webgl: { renderer: "Apple GPU" } }))).toEqual(["ok"]);
    const vm = ctx(
      UA.chromeWin,
      {},
      { webgl: { renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader)" } },
    );
    expect(ids(new GpuCheck(), vm)).toContain("gpu-software");
  });

  it("computes zone offsets on the server, daylight saving included", () => {
    expect(zoneOffsetMinutes("America/Sao_Paulo", NOW)).toBe(-180);
    expect(zoneOffsetMinutes("Asia/Kolkata", NOW)).toBe(330);
    expect(zoneOffsetMinutes("Europe/Lisbon", NOW)).toBe(60); // summer time until late October
    expect(zoneOffsetMinutes("UTC", NOW)).toBe(0);
    expect(zoneOffsetMinutes("Nowhere/Atlantis", NOW)).toBeNull();
  });

  it("catches a time zone spoofed by half", () => {
    const honest = ctx(UA.chromeWin, {}, { timezone: "America/Sao_Paulo", timezoneOffsetMinutes: -180 });
    expect(verdicts(new TimezoneCheck(), honest)).toEqual(["info"]);
    const spoofed = ctx(UA.chromeWin, {}, { timezone: "Europe/Berlin", timezoneOffsetMinutes: -180 });
    expect(verdicts(new TimezoneCheck(), spoofed)).toEqual(["contradicao"]);
  });

  it("recognises automation", () => {
    expect(new AutomationCheck().run(ctx(UA.chromeWin, {}, { webdriver: false, pluginCount: 5 }))).toEqual([]);
    const driven = new AutomationCheck().run(ctx(UA.headless, {}, { webdriver: true, pluginCount: 0 }));
    expect(driven[0].evidence).toEqual([
      "navigator.webdriver: true",
      "User-Agent contém HeadlessChrome",
      "navigator.plugins: 0 (Chrome de desktop lista 5)",
    ]);
  });

  it("estimates the current stable release from the cadence", () => {
    expect(expectedStable("chrome", NOW)).toBe(153);
    expect(expectedStable("firefox", NOW)).toBe(157);
    expect(expectedStable("safari", NOW)).toBeNull();
  });

  it("flags a browser several releases behind, but not an ESR", () => {
    expect(verdicts(new OutdatedBrowserCheck(), ctx(UA.chromeWin))).toEqual(["ok"]);
    const old = UA.chromeWin.replace("Chrome/153", "Chrome/139");
    expect(new OutdatedBrowserCheck().run(ctx(old))[0]).toMatchObject({ verdict: "exposto" });
    const esr = UA.firefoxLinux.replace(/157/g, "140");
    expect(verdicts(new OutdatedBrowserCheck(), ctx(esr))).toEqual(["info"]);
    expect(new OutdatedBrowserCheck().run(ctx(UA.curl))).toEqual([]);
  });

  it("counts the stable traits a page can read", () => {
    const probe: ClientProbe = {
      canvasHash: "a1b2c3d4",
      webgl: { renderer: "Apple GPU" },
      screen: { width: 390, height: 844, pixelRatio: 3, colorDepth: 24 },
      timezone: "America/Sao_Paulo",
      languages: ["pt-BR"],
    };
    const [finding] = new FingerprintSurfaceCheck().run(ctx(UA.safariIphone, {}, probe));
    expect(finding.title).toContain("5 traços");
    expect(new FingerprintSurfaceCheck().run(ctx(UA.curl))).toEqual([]);
  });
});

describe("network checks", () => {
  it("separates masked, local and extra public addresses", () => {
    const check = new WebRtcLeakCheck();
    expect(verdicts(check, ctx(UA.chromeWin, {}, { webrtcCandidates: ["a1b2.local"] }))).toEqual(["ok"]);
    expect(verdicts(check, ctx(UA.chromeWin, {}, { webrtcCandidates: [] }))).toEqual(["ok"]);
    const leaky = ctx(UA.chromeWin, {}, { webrtcCandidates: ["192.168.0.12", "2804:14c:1:2::5", "200.150.1.2"] });
    expect(ids(check, leaky)).toEqual(["webrtc-local", "webrtc-public"]);
    expect(check.run(ctx(UA.curl))).toEqual([]);
  });

  it("reports the name behind the IP", () => {
    const named = { ...ctx(UA.chromeWin), reverseDns: "200-150-1-2.user.provedor.net.br" };
    expect(new ReverseDnsCheck().run(named)[0]).toMatchObject({ verdict: "exposto" });
    expect(verdicts(new ReverseDnsCheck(), ctx(UA.chromeWin))).toEqual(["ok"]);
  });
});
