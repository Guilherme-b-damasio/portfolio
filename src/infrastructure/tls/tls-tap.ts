import net from "node:net";
import type tls from "node:tls";
import type { TappedConnections, TlsFingerprint } from "../../domain/tls.js";
import { bytesMissing, parseClientHello } from "./client-hello.js";
import { ja4 } from "./ja4.js";
import { readProxyHeader } from "./proxy-protocol.js";

const key = (address: string | undefined, port: number | undefined) => `${address}:${port}`;

interface Tapped {
  fingerprint: TlsFingerprint | null;
  client: string | null;
}

export interface TlsTapOptions {
  /**
   * Expect a PROXY protocol header before the ClientHello. Only for a port that a trusted proxy
   * alone can reach: whoever writes the header chooses the address the app believes.
   */
  proxyProtocol?: boolean;
  helloTimeoutMs?: number;
  maxTracked?: number;
}

/**
 * Sits in front of a TLS server and reads each connection's opening bytes before the handshake
 * starts: an optional PROXY header, then the ClientHello. The hello is fingerprinted and put back
 * on the socket, so the TLS server sees exactly what the client sent. Entries live as long as their socket.
 */
export class TlsTap implements TappedConnections {
  private readonly bySocket = new Map<string, Tapped>();
  private readonly proxyProtocol: boolean;
  private readonly helloTimeoutMs: number;
  private readonly maxTracked: number;

  constructor({ proxyProtocol = false, helloTimeoutMs = 5_000, maxTracked = 2_000 }: TlsTapOptions = {}) {
    this.proxyProtocol = proxyProtocol;
    this.helloTimeoutMs = helloTimeoutMs;
    this.maxTracked = maxTracked;
  }

  get tracked(): number {
    return this.bySocket.size;
  }

  fingerprint(remoteAddress: string, remotePort: number): TlsFingerprint | null {
    return this.bySocket.get(key(remoteAddress, remotePort))?.fingerprint ?? null;
  }

  clientAddress(remoteAddress: string, remotePort: number): string | null {
    return this.bySocket.get(key(remoteAddress, remotePort))?.client ?? null;
  }

  /** A plain TCP server that taps each connection and then gives it to `tlsServer` (an https.Server works). */
  server(tlsServer: tls.Server, maxConnections = 500): net.Server {
    const tcp = net.createServer((socket) => this.accept(socket, tlsServer));
    tcp.maxConnections = maxConnections;
    return tcp;
  }

  private accept(socket: net.Socket, tlsServer: tls.Server) {
    const id = key(socket.remoteAddress, socket.remotePort);
    let buf = Buffer.alloc(0);
    let awaitingProxy = this.proxyProtocol;
    let client: string | null = null;
    // A client that opens a socket and says nothing doesn't get to hold it.
    const timer = setTimeout(() => socket.destroy(), this.helloTimeoutMs);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => {
      clearTimeout(timer);
      this.bySocket.delete(id);
    });

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (awaitingProxy) {
        let header;
        try {
          header = readProxyHeader(buf);
        } catch {
          return socket.destroy(); // the header is mandatory here: no header, no connection
        }
        if (!header.complete) return;
        client = header.client?.address ?? null;
        buf = buf.subarray(header.length);
        awaitingProxy = false;
        if (!buf.length) return;
      }

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
      if (this.bySocket.size < this.maxTracked) {
        let fingerprint: TlsFingerprint | null = null;
        try {
          if (complete) fingerprint = ja4(parseClientHello(buf));
        } catch {
          // Unparseable hello: no fingerprint, the connection still goes through.
        }
        if (fingerprint || client) this.bySocket.set(id, { fingerprint, client });
      }
      // Only the TLS bytes go back: the PROXY header was for us, not for the TLS server.
      // Node's TLS socket drains what is buffered on the raw socket before reading from the wire.
      socket.unshift(buf);
      tlsServer.emit("connection", socket);
    };
    socket.on("data", onData);
  }
}
