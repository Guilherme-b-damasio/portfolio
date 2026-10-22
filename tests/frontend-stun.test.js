// Plain JS so it can import public/js/stun.js as the browser does, without type declarations.
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateParts, runStun } from "../public/js/stun.js";

const SERVERS = [
  { host: "stun.example.test", port: 3478 },
  { host: "stun.example.test", port: 3479 },
];

/** A peer connection that hands out the candidates it was built with, then ends the gathering. */
function fakePeerConnection(candidates, { built } = {}) {
  return class {
    constructor(config) {
      built?.(config);
      this.onicecandidate = null;
    }
    createDataChannel() {}
    async createOffer() {
      return { type: "offer", sdp: "" };
    }
    async setLocalDescription() {
      for (const candidate of candidates) this.onicecandidate?.({ candidate });
      this.onicecandidate?.({ candidate: null });
    }
    close() {
      this.closed = true;
    }
  };
}

function fakeFetch(handlers) {
  return vi.fn(async (path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const { status = 200, json } = handlers[`${init.method ?? "GET"} ${path}`](body);
    return {
      ok: status < 400,
      status,
      headers: new Map([["content-type", "application/json"]]),
      json: async () => json,
    };
  });
}

afterEach(() => {
  delete globalThis.RTCPeerConnection;
  vi.unstubAllGlobals();
});

describe("runStun", () => {
  it("aims at every socket the server lists and sends back the reflexive addresses", async () => {
    let config = null;
    globalThis.RTCPeerConnection = fakePeerConnection(
      [
        { type: "host", address: "192.168.0.10", port: 50000 },
        { type: "srflx", address: "203.0.113.9", port: 54321, relatedPort: 50000, protocol: "udp" },
        { type: "srflx", address: "203.0.113.9", port: 54321, relatedPort: 50000, protocol: "udp" }, // the other server
      ],
      { built: (c) => (config = c) },
    );
    let posted = null;
    vi.stubGlobal(
      "fetch",
      fakeFetch({
        "GET /api/stun": () => ({ json: { servers: SERVERS, pending: true } }),
        "POST /api/stun": (body) => {
          posted = body;
          return { json: { verdict: "info", headline: "mesma porta", mapping: "porta-fixa" } };
        },
      }),
    );

    const urls = [];
    const result = await runStun({ onGather: (u) => urls.push(...u) });
    expect(config.iceServers).toEqual([
      { urls: "stun:stun.example.test:3478" },
      { urls: "stun:stun.example.test:3479" },
    ]);
    expect(urls).toEqual(["stun:stun.example.test:3478", "stun:stun.example.test:3479"]);
    expect(posted).toEqual({ candidates: [{ address: "203.0.113.9", port: 54321 }] });
    expect(result.report.mapping).toBe("porta-fixa");
    expect(result.candidates).toEqual([{ address: "203.0.113.9", port: 54321, relatedPort: 50000, protocol: "udp" }]);
  });

  it("says the test is off instead of opening a connection", async () => {
    globalThis.RTCPeerConnection = fakePeerConnection([]);
    vi.stubGlobal(
      "fetch",
      fakeFetch({ "GET /api/stun": () => ({ status: 503, json: { off: true, error: "desligado" } }) }),
    );
    expect(await runStun()).toEqual({ off: true });
  });

  it("says so when the browser has no WebRTC", async () => {
    vi.stubGlobal("fetch", fakeFetch({ "GET /api/stun": () => ({ json: { servers: SERVERS } }) }));
    const result = await runStun();
    expect(result.error).toMatch(/WebRTC/);
  });
});

describe("candidateParts", () => {
  it("spells out the mapping both ways", () => {
    expect(candidateParts({ address: "203.0.113.9", port: 54321, relatedPort: 50000 })).toEqual({
      where: "203.0.113.9:54321",
      local: "porta local 50000",
    });
    expect(candidateParts({ address: "203.0.113.9", port: 54321, relatedPort: null }).local).toBe(
      "porta local escondida",
    );
  });
});
