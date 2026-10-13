import { createHash } from "node:crypto";
import type { ClientHello, TlsFingerprint } from "../../domain/tls.js";
import { isGrease } from "../../domain/tls.js";

// Follows the FoxIO JA4 spec (technical_details/JA4.md); the tests use its worked example.

const VERSIONS: Record<string, string> = {
  "0304": "13",
  "0303": "12",
  "0302": "11",
  "0301": "10",
  "0300": "s3",
  "0002": "s2",
  feff: "d1",
  fefd: "d2",
  fefc: "d3",
};

const sha12 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const two = (n: number) => String(Math.min(n, 99)).padStart(2, "0");
const alnum = (c: number) => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

function version(hello: ClientHello): string {
  const offered = hello.supportedVersions.filter((v) => !isGrease(v));
  const highest = offered.length ? offered.reduce((a, b) => (parseInt(b, 16) > parseInt(a, 16) ? b : a)) : null;
  return VERSIONS[highest ?? hello.legacyVersion] ?? "00";
}

/** First and last character of the first ALPN value, or of its hex when either end isn't alphanumeric. */
export function alpnChars(first: string | undefined): string {
  if (!first) return "00";
  const bytes = Buffer.from(first, "latin1");
  if (bytes.length === 1 && alnum(bytes[0])) return first + first;
  if (alnum(bytes[0]) && alnum(bytes[bytes.length - 1])) return first[0] + first[first.length - 1];
  const hex = bytes.toString("hex");
  return hex[0] + hex[hex.length - 1];
}

export function cipherHash(ciphers: string[]): { raw: string; hash: string } {
  const raw = ciphers
    .filter((c) => !isGrease(c))
    .sort()
    .join(",");
  return { raw, hash: raw ? sha12(raw) : "000000000000" };
}

export function extensionHash(extensions: string[], signatureAlgorithms: string[]): { raw: string; hash: string } {
  const sorted = extensions
    .filter((e) => !isGrease(e) && e !== "0000" && e !== "0010")
    .sort()
    .join(",");
  if (!sorted) return { raw: "", hash: "000000000000" };
  // GREASE goes everywhere it is ignored: Chromium also slips it into the signature algorithms.
  const sigs = signatureAlgorithms.filter((s) => !isGrease(s));
  const raw = sigs.length ? `${sorted}_${sigs.join(",")}` : sorted;
  return { raw, hash: sha12(raw) };
}

/** JA4 for a ClientHello received over TCP. */
export function ja4(hello: ClientHello): TlsFingerprint {
  const ciphers = hello.ciphers.filter((c) => !isGrease(c));
  const extensions = hello.extensions.filter((e) => !isGrease(e));
  const a = `t${version(hello)}${hello.extensions.includes("0000") ? "d" : "i"}${two(ciphers.length)}${two(extensions.length)}${alpnChars(hello.alpn[0])}`;
  const b = cipherHash(hello.ciphers);
  const c = extensionHash(hello.extensions, hello.signatureAlgorithms);
  return { ja4: `${a}_${b.hash}_${c.hash}`, ja4r: `${a}_${b.raw}_${c.raw}`, hello };
}
