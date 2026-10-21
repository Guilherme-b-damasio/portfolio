import http from "node:http";
import type http2 from "node:http2";
import type net from "node:net";
import type { Duplex } from "node:stream";
import { duplexPair } from "./duplex-pair.js";

// Connection-specific headers: meaningless across the hop, and HTTP/2 refuses them outright.
const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "http2-settings",
]);

/**
 * Serves an HTTP/1.1 app to HTTP/2 clients. Express doesn't run on Node's http2 compatibility
 * API, so each h2 stream is replayed as an HTTP/1.1 request to the app over an in-memory pipe.
 * The pipe carries the visitor's address and port, so rate limits and the tap's lookups see the
 * real peer and not a loopback hop. Decrypted HTTP/1.1 connections are handed over as they are.
 */
export class Http1Bridge {
  private readonly http1: http.Server;

  constructor(app: http.RequestListener) {
    this.http1 = http.createServer(app);
  }

  /** An already-decrypted HTTP/1.1 connection. */
  accept(socket: Duplex) {
    this.http1.emit("connection", socket);
  }

  forward(req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) {
    const [near, far] = duplexPair();
    const peer = req.stream.session?.socket;
    Object.assign(far, {
      remoteAddress: peer?.remoteAddress,
      remotePort: peer?.remotePort,
      remoteFamily: peer?.remoteFamily,
      encrypted: true, // so req.secure and req.protocol say https, as they would over HTTP/1.1
    });
    this.http1.emit("connection", far);

    // Same headers in the same order the client sent them, :authority standing in for Host.
    const headers: string[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i].toLowerCase();
      if (name === ":authority") headers.push("host", req.rawHeaders[i + 1]);
      else if (!name.startsWith(":") && !HOP.has(name)) headers.push(name, req.rawHeaders[i + 1]);
    }
    const upstream = http.request({
      createConnection: () => near as net.Socket,
      method: req.method,
      path: req.url,
      headers,
      setHost: false,
    });
    upstream.on("response", (up) => {
      const out: http.OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(up.headers))
        if (!HOP.has(name) && value !== undefined) out[name] = value;
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    });
    upstream.on("error", () => {
      if (res.headersSent) return res.stream.close();
      res.writeHead(502).end();
    });
    // A visitor who leaves mid-answer (an SSE stream, say) stops the app's side too.
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  }
}
