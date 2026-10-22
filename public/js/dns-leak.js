import { api } from "./api.js";
import { leakProbeUrl } from "./lib.js";

const WAIT_MS = 1_200; // between reads: a resolver answers in tens of ms, a cold path in a second
const MAX_READS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs one DNS leak test: gets a fresh name, makes the browser resolve it through an image that
 * is meant to fail, then reads which resolvers asked. Reads again once after the first resolver
 * shows up, since a system often asks a second one. Resolves with { off } or { error } or { report }.
 */
export async function runDnsLeak({ onProbe } = {}) {
  const started = await api("/api/dns-leak", { method: "POST" });
  if (!started.res.ok)
    return started.body?.off ? { off: true } : { error: started.body?.error ?? `erro ${started.res.status}` };
  const { token, hostname } = started.body;
  onProbe?.(hostname);
  const img = new Image();
  img.referrerPolicy = "no-referrer";
  img.src = leakProbeUrl(hostname);

  let report = null;
  let extra = 1;
  for (let i = 0; i < MAX_READS; i++) {
    await sleep(WAIT_MS);
    const { res, body } = await api(`/api/dns-leak/${token}`, { auto: i > 0 });
    if (!res.ok) return { error: body?.error ?? `erro ${res.status}` };
    report = body;
    if (!report.pending && extra-- <= 0) break;
  }
  img.src = "";
  return { report, hostname };
}
