import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import type { NatBindings } from "../../domain/stun.js";
import {
  ATTR,
  attr,
  BadMessage,
  CLASS,
  findAttribute,
  METHOD,
  parseMessage,
  type TransportAddress,
  writeMessage,
} from "./message.js";

export interface StunServerLimits {
  maxPacketBytes?: number; // larger datagrams are dropped unread
  maxRequestsPerSecond?: number; // across every sender; past it, requests are dropped and clients retry
  software?: string | null; // the SOFTWARE attribute; off by default, every byte is amplification
}

/**
 * A STUN server over UDP (`node:dgram`). Open to the whole internet, so it stays dull: it answers
 * Binding requests and nothing else, says nothing back to what is not a STUN message (the port is
 * a reflection vector otherwise), keeps the response near the size of the request and has a global
 * ceiling. Every request is recorded, by the reflexive address it came from, for a couple of minutes.
 */
export class StunServer {
  private readonly maxPacketBytes: number;
  private readonly maxRequestsPerSecond: number;
  private readonly software: string | null;
  private window = { second: 0, count: 0 };
  private socket: Socket | null = null;
  private origin: TransportAddress | null = null;
  /** The other socket of this pair, advertised as OTHER-ADDRESS (RFC 5780) once both are listening. */
  other: TransportAddress | null = null;
  readonly stats = { answered: 0, dropped: 0, ignored: 0 };

  constructor(
    private readonly bindings: NatBindings,
    { maxPacketBytes = 1_232, maxRequestsPerSecond = 200, software = null }: StunServerLimits = {},
    private readonly now: () => number = Date.now,
  ) {
    this.maxPacketBytes = maxPacketBytes;
    this.maxRequestsPerSecond = maxRequestsPerSecond;
    this.software = software;
  }

  get port(): number | null {
    return this.origin?.port ?? null;
  }

  /** Resolves with the bound port, which is the asked one unless it was 0. */
  listen(port: number, host = "0.0.0.0", type: "udp4" | "udp6" = "udp4"): Promise<number> {
    const socket = createSocket(type);
    this.socket = socket;
    socket.on("message", (msg, rinfo) => this.handle(socket, msg, rinfo));
    return new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(port, host, () => {
        socket.off("error", reject);
        // A send failure (an ICMP unreachable, a full buffer) is the sender's problem, never a crash.
        socket.on("error", () => {});
        const bound = socket.address();
        this.origin = { address: bound.address, port: bound.port };
        resolve(bound.port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => (this.socket ? this.socket.close(() => resolve()) : resolve()));
  }

  /** The answer for one datagram, or null to stay silent. Public for tests that skip the socket. */
  respond(msg: Buffer, from: TransportAddress, origin: TransportAddress | null = this.origin): Buffer | null {
    if (msg.length > this.maxPacketBytes || !this.admit()) {
      this.stats.dropped++;
      return null;
    }
    let message;
    try {
      message = parseMessage(msg);
    } catch (err) {
      if (!(err instanceof BadMessage)) throw err;
      this.stats.ignored++;
      return null;
    }
    // Indications and responses expect nothing back, and this server knows one method.
    if (message.class !== CLASS.REQUEST || message.method !== METHOD.BINDING) {
      this.stats.ignored++;
      return null;
    }
    const { transactionId } = message;
    if (message.unknownRequired.length) {
      this.stats.answered++;
      return writeMessage({
        class: CLASS.ERROR,
        transactionId,
        attributes: [attr.errorCode(420, "Unknown Attribute"), attr.unknownAttributes(message.unknownRequired)],
      });
    }

    const software = findAttribute(message, ATTR.SOFTWARE);
    this.bindings.record({
      address: from.address,
      port: from.port,
      serverPort: origin?.port ?? 0,
      software: software ? software.toString("utf8").slice(0, 64) : null,
    });
    this.stats.answered++;
    return writeMessage({
      class: CLASS.SUCCESS,
      transactionId,
      attributes: [
        attr.xorMappedAddress(from, transactionId),
        ...(origin ? [attr.responseOrigin(origin)] : []),
        ...(this.other ? [attr.otherAddress(this.other)] : []),
        ...(this.software ? [attr.software(this.software)] : []),
      ],
    });
  }

  private handle(socket: Socket, msg: Buffer, rinfo: RemoteInfo) {
    const from = { address: rinfo.address.replace(/^::ffff:/, ""), port: rinfo.port };
    const reply = this.respond(msg, from);
    if (reply) socket.send(reply, rinfo.port, rinfo.address);
  }

  private admit(): boolean {
    const second = Math.floor(this.now() / 1_000);
    if (second !== this.window.second) this.window = { second, count: 0 };
    return ++this.window.count <= this.maxRequestsPerSecond;
  }
}
