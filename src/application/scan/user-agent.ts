import type { BrowserFamily, ClaimedIdentity, OsFamily } from "../../domain/exposure.js";

// Client libraries announce themselves; a browser never sends these.
const TOOLS: [RegExp, string][] = [
  [/^curl\//i, "curl"],
  [/^Wget\//i, "wget"],
  [/python-requests/i, "python-requests"],
  [/python-httpx/i, "httpx"],
  [/aiohttp/i, "aiohttp"],
  [/Python-urllib/i, "urllib"],
  [/Go-http-client/i, "Go net/http"],
  [/^node-fetch|undici|axios/i, "Node.js"],
  [/PostmanRuntime/i, "Postman"],
  [/HeadlessChrome/i, "Chrome headless"],
];

// Order matters: Edge, Opera and Samsung all also say "Chrome", and Chrome also says "Safari".
const BROWSERS: [RegExp, BrowserFamily][] = [
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, "edge"],
  [/\bOPR\/(\d+)/, "opera"],
  [/\bSamsungBrowser\/(\d+)/, "samsung"],
  [/\b(?:Firefox|FxiOS)\/(\d+)/, "firefox"],
  [/\b(?:HeadlessChrome|Chrome|CriOS)\/(\d+)/, "chrome"],
  [/\bVersion\/(\d+)[\d.]* (?:Mobile\/\w+ )?Safari\//, "safari"],
];

const SYSTEMS: [RegExp, OsFamily][] = [
  [/\b(?:iPhone|iPad|iPod)\b/, "ios"],
  [/\bAndroid\b/, "android"],
  [/\bCrOS\b/, "chromeos"],
  [/\bWindows\b/, "windows"],
  [/\b(?:Macintosh|Mac OS X)\b/, "macos"],
  [/\bLinux\b/, "linux"],
];

/** What a User-Agent string claims. It is only a claim: the checks compare it with everything else. */
export function parseUserAgent(ua: string | undefined): ClaimedIdentity {
  const s = ua ?? "";
  const tool = TOOLS.find(([re]) => re.test(s))?.[1] ?? null;
  let browser: BrowserFamily = "outro";
  let version: number | null = null;
  for (const [re, family] of BROWSERS) {
    const m = re.exec(s);
    if (m) {
      browser = family;
      version = Number(m[1]);
      break;
    }
  }
  if (/bot|crawler|spider|slurp/i.test(s)) browser = "bot";
  const os = SYSTEMS.find(([re]) => re.test(s))?.[1] ?? "outro";
  const mobile = /\bMobi|\biPhone\b|\bAndroid\b.*\bMobile\b/.test(s);
  return { browser, version, os, mobile, tool };
}

export const BROWSER_NAMES: Record<BrowserFamily, string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
  opera: "Opera",
  samsung: "Samsung Internet",
  bot: "robô",
  outro: "desconhecido",
};

export const OS_NAMES: Record<OsFamily, string> = {
  windows: "Windows",
  macos: "macOS",
  ios: "iOS",
  android: "Android",
  linux: "Linux",
  chromeos: "ChromeOS",
  outro: "desconhecido",
};

/** Maps navigator.platform / userAgentData.platform / Sec-CH-UA-Platform to an OS family. */
export function osFromPlatform(platform: string | undefined): OsFamily | null {
  if (!platform) return null;
  const p = platform.replace(/"/g, "").toLowerCase();
  if (!p) return null;
  if (p.startsWith("win")) return "windows";
  if (p === "macos" || p.startsWith("mac")) return "macos";
  if (p === "ios" || p.startsWith("iphone") || p.startsWith("ipad") || p.startsWith("ipod")) return "ios";
  if (p === "android") return "android";
  if (p === "chrome os" || p === "chromeos" || p.includes("cros")) return "chromeos";
  // Android also reports "Linux armv8l" in navigator.platform, so Linux is compatible with it.
  if (p.startsWith("linux")) return "linux";
  return "outro";
}

/** Two OS families that may legitimately show up for the same device. */
export function sameOs(a: OsFamily, b: OsFamily): boolean {
  if (a === b) return true;
  const pair = new Set([a, b]);
  // Android's navigator.platform says Linux; iPadOS in desktop mode says Mac.
  return (pair.has("android") && pair.has("linux")) || (pair.has("ios") && pair.has("macos"));
}
