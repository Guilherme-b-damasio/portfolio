import type { Http2Fingerprint } from "./http2.js";
import type { TlsFingerprint, TlsView } from "./tls.js";

/** Where a piece of evidence comes from, outermost first. */
export type Layer = "rede" | "http" | "tls" | "navegador";

/**
 * ok: nothing to fix. info: worth knowing, not a problem by itself.
 * exposto: the visitor gives away something they could hide. contradicao: two layers disagree,
 * which is what fraud and bot detection look for (spoofed UA, timezone, automation).
 */
export type Verdict = "ok" | "info" | "exposto" | "contradicao";

/** What the server saw on the request itself. */
export interface Observation {
  ip: string;
  headers: Record<string, string | undefined>; // lowercased names
  httpVersion: string;
  viaProxy: boolean; // behind Traefik: header order and TLS are re-made by the proxy
  tls: TlsFingerprint | null; // only when the connection reached our own TLS listener
  headerOrder: string[] | null; // header names as sent, only without a proxy in between
  http2?: Http2Fingerprint | null; // only when the connection negotiated h2 with our own TLS listener
}

/** What the visitor's browser reported about itself. Every field is optional: scripts can be blocked or lie. */
export interface ClientProbe {
  userAgent?: string;
  platform?: string;
  languages?: string[];
  timezone?: string;
  timezoneOffsetMinutes?: number; // as `-new Date().getTimezoneOffset()`: east of UTC is positive
  screen?: { width: number; height: number; pixelRatio: number; colorDepth: number };
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  webdriver?: boolean;
  cookieEnabled?: boolean;
  doNotTrack?: boolean;
  globalPrivacyControl?: boolean;
  pluginCount?: number;
  webgl?: { vendor?: string; renderer?: string };
  canvasHash?: string;
  uaData?: {
    brands?: { brand: string; version: string }[];
    mobile?: boolean;
    platform?: string;
    platformVersion?: string;
    architecture?: string;
    model?: string;
    fullVersionList?: { brand: string; version: string }[];
  };
  webrtcCandidates?: string[]; // the address part of each ICE candidate gathered without a STUN server
  connection?: { effectiveType?: string; rttMs?: number; downlinkMbps?: number };
  mediaDevices?: { audioinput: number; audiooutput: number; videoinput: number };
}

/** One raw fact shown as evidence, e.g. "GPU: ANGLE (NVIDIA GeForce RTX 3060)". */
export interface Signal {
  layer: Layer;
  label: string;
  value: string;
}

export interface Finding {
  id: string;
  layer: Layer;
  verdict: Verdict;
  title: string;
  detail: string;
  evidence: string[];
  fix?: string;
}

export type BrowserFamily = "chrome" | "edge" | "firefox" | "safari" | "opera" | "samsung" | "bot" | "outro";
export type OsFamily = "windows" | "macos" | "ios" | "android" | "linux" | "chromeos" | "outro";

/** What the User-Agent header claims to be. */
export interface ClaimedIdentity {
  browser: BrowserFamily;
  version: number | null; // major version
  os: OsFamily;
  mobile: boolean;
  tool: string | null; // "curl", "python-requests"... when the UA names a client library
}

/** Everything a check needs, parsed once. */
export interface ScanContext {
  observation: Observation;
  probe: ClientProbe | null;
  claimed: ClaimedIdentity;
  reverseDns: string | null;
  now: Date;
}

/** One rule of the scan. New rules are new classes; the use case never changes (open/closed). */
export interface ExposureCheck {
  readonly id: string;
  run(ctx: ScanContext): Finding[];
}

/** PTR lookup for the visitor's IP. Must answer fast or give up: it sits on the request path. */
export interface ReverseDns {
  lookup(ip: string): Promise<string | null>;
}

export interface ExposureReport {
  claimed: ClaimedIdentity;
  signals: Signal[];
  findings: Finding[];
  summary: { exposures: number; contradictions: number; checks: number; probe: boolean };
  tls: TlsView | null; // the visitor's own ClientHello, for the annotated hex dump
  scannedAt: string;
}
