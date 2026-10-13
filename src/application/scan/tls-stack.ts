import type { ClaimedIdentity } from "../../domain/exposure.js";
import { type ClientHello, isGrease } from "../../domain/tls.js";

export type TlsFamily = "boringssl" | "apple" | "nss" | "openssl" | "schannel" | "go" | "desconhecida";

export const FAMILY_NAMES: Record<TlsFamily, string> = {
  boringssl: "BoringSSL (Chrome, Edge e outros Chromium)",
  apple: "a pilha da Apple (Safari e todo navegador no iOS)",
  nss: "NSS (Firefox)",
  openssl: "OpenSSL (curl, Python, Node.js, Ruby…)",
  schannel: "Schannel (Windows: curl.exe, PowerShell, .NET)",
  go: "crypto/tls do Go",
  desconhecida: "uma pilha que não reconheço",
};

const has = (hello: ClientHello, ext: string) => hello.extensions.includes(ext);

/**
 * Which TLS library wrote this ClientHello, from traits each one has and the others lack.
 * Only browsers GREASE; only Chromium sends ALPS; Firefox alone sends record_size_limit;
 * OpenSSL alone still offers encrypt_then_mac. Read from real handshakes, not from a hash table.
 */
export function classifyStack(hello: ClientHello): { family: TlsFamily; evidence: string[] } {
  const grease = hello.ciphers.some(isGrease) || hello.extensions.some(isGrease);
  const alps = has(hello, "4469") || has(hello, "44cd");
  if (grease && alps) return { family: "boringssl", evidence: ["GREASE", "ALPS (application_settings)"] };
  if (grease) return { family: "apple", evidence: ["GREASE", "sem ALPS"] };
  if (has(hello, "001c")) return { family: "nss", evidence: ["sem GREASE", "record_size_limit"] };
  if (has(hello, "0016")) return { family: "openssl", evidence: ["sem GREASE", "encrypt_then_mac"] };
  if (has(hello, "0031"))
    return { family: "schannel", evidence: ["sem GREASE", "post_handshake_auth sem encrypt_then_mac"] };
  if (has(hello, "0012"))
    return { family: "go", evidence: ["sem GREASE", "signed_certificate_timestamp sem encrypt_then_mac"] };
  return { family: "desconhecida", evidence: [grease ? "GREASE" : "sem GREASE"] };
}

/** The TLS library a browser claiming to be `claimed` must be using, or null when anything goes. */
export function expectedFamily(claimed: ClaimedIdentity): TlsFamily | null {
  if (claimed.tool) return null;
  if (claimed.os === "ios") return "apple"; // Apple requires WebKit and its network stack for every iOS browser
  if (["chrome", "edge", "opera", "samsung"].includes(claimed.browser)) return "boringssl";
  if (claimed.browser === "firefox") return "nss";
  if (claimed.browser === "safari") return "apple";
  return null;
}
