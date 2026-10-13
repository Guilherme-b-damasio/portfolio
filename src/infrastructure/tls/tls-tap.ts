import net from "node:net";
import type tls from "node:tls";
import type { TlsFingerprint, TlsFingerprintSource } from "../../domain/tls.js";
import { bytesMissing, parseClientHello } from "./client-hello.js";
import { ja4 } from "./ja4.js";

const key = (address: string | undefined, port: number | undefined) => `${address}:${port}`;

/**
 * Sits in front of a TLS server and reads each connection's ClientHello before the handshake
 * starts: the bytes are fingerprinted, put back on the socket and the socket is handed over,
 * so the TLS server sees exactly what the client sent. A fingerprint lives as long as its socket.
 */
export class TlsTap implements TlsFingerprintSource {
  private readonly bySocket = new Map<string, TlsFingerprint>();

  constructor(
    private readonly helloTimeoutMs = 5_000,
    private readonly maxTracked = 2_000,
  ) {}

  get tracked(): number {
    return this.bySocket.size;
  }

  lookup(remoteAddress: string, remotePort: number): TlsFingerprint | null {
    return this.bySocket.get(key(remoteAddress, remotePort)) ?? null;
  }

  /** A plain TCP server that taps each connection and then gives it to `tlsServer` (an https.Server works). */
  server(tlsServer: tls.Server, maxConnections = 500): net.Server {
    const tcp = net.createServer((socket) => this.accept(socket, tlsServer));
    tcp.maxConnections = maxConnections;
    return tcp;
  }

  private accept(socket: net.Socket, tlsServer: tls.Server) {
    const id = key(socket.remoteAddress, socket.remotePort);
    const chunks: Buffer[] = [];
    // A client that opens a socket and says nothing doesn't get to hold it.
    const timer = setTimeout(() => socket.destroy(), this.helloTimeoutMs);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      clearTimeout(timer);
      this.bySocket.delete(id);
    });

    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      let complete: boolean;
      try {
        complete = bytesMissing(buf) === 0;
        if (!complete) return; // keep reading
      } catch {
        complete = false; // not a ClientHello: let the TLS server answer it with a proper alert
      }
      socket.off("data", onData);
      socket.pause();
      clearTimeout(timer);
      if (complete && this.bySocket.size < this.maxTracked) {
        try {
          this.bySocket.set(id, ja4(parseClientHello(buf)));
        } catch {
          // Unparseable hello: no fingerprint, the connection still goes through.
        }
      }
      // Node's TLS socket drains what is buffered on the raw socket before reading from the wire.
      socket.unshift(buf);
      tlsServer.emit("connection", socket);
    };
    socket.on("data", onData);
  }
}
