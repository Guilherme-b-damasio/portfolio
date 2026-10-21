import http2 from "node:http2";
import tls from "node:tls";
import type { Http2Connections, Http2Fingerprint } from "../../domain/http2.js";
import { http2Fingerprint } from "./akamai.js";
import type { Http1Bridge } from "./http1-bridge.js";
import { parseHttp2Preface, prefaceBytesMissing } from "./preface.js";

const key = (address: string | undefined, port: number | undefined) => `${address}:${port}`;

export interface AlpnServerOptions {
  prefaceTimeoutMs?: number;
  maxTracked?: number;
  maxStreams?: number; // concurrent streams per HTTP/2 connection
  idleTimeoutMs?: number;
}

/**
 * Terminates TLS offering h2 and http/1.1. HTTP/1.1 goes straight to the app; on h2 the first
 * decrypted bytes (the client preface up to its first request) are read and fingerprinted, put
 * back, and the connection is served by an HTTP/2 server that bridges each stream to the app.
 */
export class AlpnServer implements Http2Connections {
  readonly server: tls.Server;
  private readonly h2: http2.Http2Server;
  private readonly byConnection = new Map<string, Http2Fingerprint>();
  private readonly prefaceTimeoutMs: number;
  private readonly maxTracked: number;

  constructor(
    private readonly bridge: Http1Bridge,
    credentials: tls.SecureContextOptions,
    { prefaceTimeoutMs = 5_000, maxTracked = 2_000, maxStreams = 16, idleTimeoutMs = 120_000 }: AlpnServerOptions = {},
  ) {
    this.prefaceTimeoutMs = prefaceTimeoutMs;
    this.maxTracked = maxTracked;
    this.server = tls.createServer({ ...credentials, ALPNProtocols: ["h2", "http/1.1"] }, (s) => this.accept(s));
    this.h2 = http2.createServer({ settings: { maxConcurrentStreams: maxStreams }, maxSessionMemory: 4 }, (req, res) =>
      bridge.forward(req, res),
    );
    this.h2.setTimeout(idleTimeoutMs);
  }

  get tracked(): number {
    return this.byConnection.size;
  }

  http2(remoteAddress: string, remotePort: number): Http2Fingerprint | null {
    return this.byConnection.get(key(remoteAddress, remotePort)) ?? null;
  }

  private accept(socket: tls.TLSSocket) {
    if (socket.alpnProtocol !== "h2") return this.bridge.accept(socket);
    const id = key(socket.remoteAddress, socket.remotePort);
    let buf = Buffer.alloc(0);
    // A client that negotiates h2 and then says nothing doesn't get to hold the socket.
    const timer = setTimeout(() => socket.destroy(), this.prefaceTimeoutMs);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      clearTimeout(timer);
      this.byConnection.delete(id);
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
      if (fingerprint && this.byConnection.size < this.maxTracked) this.byConnection.set(id, fingerprint);
      socket.unshift(buf);
      this.h2.emit("connection", socket);
    };
    socket.on("data", onData);
  }
}
