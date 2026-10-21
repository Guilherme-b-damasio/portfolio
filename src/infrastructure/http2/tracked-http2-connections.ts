import type { Http2Connections, Http2Fingerprint } from "../../domain/http2.js";

const key = (address: string | undefined, port: number | undefined) => `${address}:${port}`;

/** The h2 fingerprint of each open connection, by peer address. Entries live as long as their socket. */
export class TrackedHttp2Connections implements Http2Connections {
  private readonly byConnection = new Map<string, Http2Fingerprint>();

  constructor(private readonly maxTracked = 2_000) {}

  get tracked(): number {
    return this.byConnection.size;
  }

  http2(remoteAddress: string, remotePort: number): Http2Fingerprint | null {
    return this.byConnection.get(key(remoteAddress, remotePort)) ?? null;
  }

  remember(remoteAddress: string | undefined, remotePort: number | undefined, fingerprint: Http2Fingerprint) {
    if (this.byConnection.size < this.maxTracked) this.byConnection.set(key(remoteAddress, remotePort), fingerprint);
  }

  forget(remoteAddress: string | undefined, remotePort: number | undefined) {
    this.byConnection.delete(key(remoteAddress, remotePort));
  }
}
