import http2 from "node:http2";
import tls from "node:tls";
import type { Http2Fingerprint } from "../../domain/http2.js";
import { http2Fingerprint } from "./akamai.js";
import type { Http1Bridge } from "./http1-bridge.js";
import { parseHttp2Preface, prefaceBytesMissing } from "./preface.js";
import type { TrackedHttp2Connections } from "./tracked-http2-connections.js";

export interface AlpnServerOptions {
  prefaceTimeoutMs?: number;
  maxStreams?: number; // concurrent streams per HTTP/2 connection
  idleTimeoutMs?: number;
}

/**
 * Terminates TLS offering h2 and http/1.1. HTTP/1.1 goes straight to the app; on h2 the first
 * decrypted bytes (the client preface up to its first request) are read and fingerprinted, put
 * back, and the connection is served by an HTTP/2 server that bridges each stream to the app.
 * The fingerprints go to `connections`, which the app reads them from.
 */
export class AlpnServer {
  readonly server: tls.Server;
  private readonly h2: http2.Http2Server;
  private readonly prefaceTimeoutMs: number;

  constructor(
    private readonly bridge: Http1Bridge,
    credentials: tls.SecureContextOptions,
    private readonly connections: TrackedHttp2Connections,
    { prefaceTimeoutMs = 5_000, maxStreams = 16, idleTimeoutMs = 120_000 }: AlpnServerOptions = {},
  ) {
    this.prefaceTimeoutMs = prefaceTimeoutMs;
    this.server = tls.createServer({ ...credentials, ALPNProtocols: ["h2", "http/1.1"] }, (s) => this.accept(s));
    this.h2 = http2.createServer({ settings: { maxConcurrentStreams: maxStreams }, maxSessionMemory: 4 }, (req, res) =>
      bridge.forward(req, res),
    );
    this.h2.setTimeout(idleTimeoutMs);
  }

  private accept(socket: tls.TLSSocket) {
    if (socket.alpnProtocol !== "h2") return this.bridge.accept(socket);
    const { remoteAddress, remotePort } = socket;
    let buf = Buffer.alloc(0);
    // A client that negotiates h2 and then says nothing doesn't get to hold the socket.
    const timer = setTimeout(() => socket.destroy(), this.prefaceTimeoutMs);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      clearTimeout(timer);
      this.connections.forget(remoteAddress, remotePort);
    });

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      let fingerprint: Http2Fingerprint | null = null;
      try {
        if (prefaceBytesMissing(buf) > 0) return; // keep reading
        fingerprint = http2Fingerprint(parseHttp2Preface(buf));
      } catch {
        // Not a preface we can read: no fingerprint, and the HTTP/2 server answers it as it sees fit.
      }
      socket.off("data", onData);
      socket.pause();
      clearTimeout(timer);
      if (fingerprint) this.connections.remember(remoteAddress, remotePort, fingerprint);
      socket.unshift(buf);
      this.h2.emit("connection", socket);
    };
    socket.on("data", onData);
  }
}
