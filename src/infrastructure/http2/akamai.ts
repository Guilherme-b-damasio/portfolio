import { createHash } from "node:crypto";
import type { Http2Fingerprint, Http2Preface } from "../../domain/http2.js";

// Follows "Passive Fingerprinting of HTTP/2 Clients" (Akamai, Black Hat EU 2017):
// S[;]|WU|P[,]|PS[,], with "00" for a missing window update and "0" for no PRIORITY frames.

export function akamaiString(p: Http2Preface): string {
  const settings = p.settings.map((s) => `${s.id}:${s.value}`).join(";");
  const wu = p.windowUpdate === null ? "00" : String(p.windowUpdate);
  const priorities = p.priorities.length
    ? p.priorities.map((x) => `${x.stream}:${x.exclusive ? 1 : 0}:${x.dependsOn}:${x.weight}`).join(",")
    : "0";
  const pseudo = p.pseudoHeaders.map((h) => h[1]).join(",");
  return `${settings}|${wu}|${priorities}|${pseudo}`;
}

export function http2Fingerprint(preface: Http2Preface): Http2Fingerprint {
  const akamai = akamaiString(preface);
  return { akamai, hash: createHash("md5").update(akamai).digest("hex"), preface };
}
