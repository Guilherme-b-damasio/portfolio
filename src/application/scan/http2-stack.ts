import type { ClaimedIdentity } from "../../domain/exposure.js";
import type { Http2Preface } from "../../domain/http2.js";

export type Http2Family = "chromium" | "firefox" | "apple" | "curl" | "desconhecida";

export const HTTP2_FAMILY_NAMES: Record<Http2Family, string> = {
  chromium: "Chromium (Chrome, Edge e outros)",
  firefox: "Firefox",
  apple: "a pilha da Apple (Safari e todo navegador no iOS)",
  curl: "curl (nghttp2)",
  desconhecida: "uma biblioteca HTTP/2 que não reconheço",
};

const setting = (p: Http2Preface, id: number) => p.settings.find((s) => s.id === id)?.value;

/**
 * Who wrote this HTTP/2 preface, from traits each client has kept for years: the pseudo-header
 * order (Chromium m,a,s,p; Firefox m,p,a,s; Safari :method then :scheme; curl m,p,s,a) and the
 * initial window each one asks for. HTTP libraries copy the order sometimes, the window rarely.
 */
export function classifyHttp2(p: Http2Preface): { family: Http2Family; evidence: string[] } {
  const order = p.pseudoHeaders.map((h) => h[1]).join(",");
  const window = setting(p, 4);
  const evidence = [`pseudo-headers ${order || "nenhum"}`, `INITIAL_WINDOW_SIZE ${window ?? "padrão"}`];
  if (order === "m,a,s,p" && window === 6291456) return { family: "chromium", evidence };
  if (order === "m,p,a,s" && window === 131072) return { family: "firefox", evidence };
  if (order.startsWith("m,s,")) return { family: "apple", evidence: evidence.slice(0, 1) };
  if (order === "m,p,s,a") return { family: "curl", evidence: evidence.slice(0, 1) };
  return { family: "desconhecida", evidence };
}

/** The HTTP/2 stack a browser claiming to be `claimed` must have, or null when anything goes. */
export function expectedHttp2Family(claimed: ClaimedIdentity): Http2Family | null {
  if (claimed.tool) return null;
  if (claimed.os === "ios") return "apple"; // every iOS browser runs on WebKit's network stack
  if (["chrome", "edge", "opera", "samsung"].includes(claimed.browser)) return "chromium";
  if (claimed.browser === "firefox") return "firefox";
  if (claimed.browser === "safari") return "apple";
  return null;
}
