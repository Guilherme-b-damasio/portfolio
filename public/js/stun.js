import { api } from "./api.js";

const GATHER_MS = 4_000; // ICE usually finishes in well under a second; this is the giving-up point

/**
 * Runs one NAT test: asks the server which STUN sockets to aim at, makes the browser gather ICE
 * candidates against them, then sends back the reflexive addresses it was given so the server can
 * compare them with the address this page came over. Nothing but the candidates leaves the page,
 * and the peer connection is closed as soon as the gathering ends.
 *
 * Resolves with { off } or { error } or { report, candidates }.
 */
export async function runStun({ onGather } = {}) {
  const first = await api("/api/stun");
  if (!first.res.ok)
    return first.body?.off ? { off: true } : { error: first.body?.error ?? `erro ${first.res.status}` };
  const servers = first.body.servers ?? [];
  if (!servers.length) return { off: true };
  if (typeof RTCPeerConnection !== "function") return { error: "este navegador não tem WebRTC" };

  const urls = servers.map(({ host, port }) => `stun:${host ?? location.hostname}:${port}`);
  onGather?.(urls);
  let candidates;
  try {
    candidates = await gather(urls);
  } catch (err) {
    return { error: err.message };
  }

  const { res, body } = await api("/api/stun", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidates: candidates.map(({ address, port }) => ({ address, port })) }),
  });
  if (!res.ok) return { error: body?.error ?? `erro ${res.status}` };
  return { report: body, candidates, urls };
}

/**
 * The server-reflexive candidates of one short-lived peer connection, one STUN server per entry so
 * the browser queries both. `relatedPort` is the local port behind the mapping, which is what makes
 * "the NAT kept your port" readable next to the reflexive one.
 */
function gather(urls) {
  const pc = new RTCPeerConnection({ iceServers: urls.map((url) => ({ urls: url })) });
  const found = [];
  return new Promise((resolve, reject) => {
    const done = (err) => {
      clearTimeout(timer);
      pc.onicecandidate = null;
      pc.close();
      if (err && !found.length) reject(err);
      else resolve(found);
    };
    const timer = setTimeout(() => done(new Error("o WebRTC não respondeu a tempo")), GATHER_MS);
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return done();
      if (candidate.type !== "srflx" || !candidate.address) return;
      const seen = found.some((c) => c.address === candidate.address && c.port === candidate.port);
      if (!seen)
        found.push({
          address: candidate.address,
          port: candidate.port,
          relatedPort: candidate.relatedPort ?? null,
          protocol: candidate.protocol ?? "udp",
        });
    };
    pc.createDataChannel("nat");
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch((err) => done(new Error(err?.message ?? "o WebRTC falhou")));
  });
}

/** The shared wording for one reflexive candidate, used by the page and by the terminal. */
export function candidateParts(candidate) {
  return {
    where: `${candidate.address}:${candidate.port}`,
    local: candidate.relatedPort ? `porta local ${candidate.relatedPort}` : "porta local escondida",
  };
}
