import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import type { LeakZone } from "./leak-zone.js";
import { BadMessage, formatError, parseQuery, writeAnswer } from "./message.js";

export interface DnsServerLimits {
  maxPacketBytes?: number; // larger datagrams are dropped unread
  maxQueriesPerSecond?: number; // across every sender; past it, queries are dropped and resolvers retry
}

/**
 * The leak zone over UDP (`node:dgram`). Open to the whole internet, so it is kept dull on purpose:
 * one zone, answers barely larger than the questions (no amplification), and a global ceiling.
 */
export class AuthoritativeDnsServer {
  private readonly maxPacketBytes: number;
  private readonly maxQueriesPerSecond: number;
  private window = { second: 0, count: 0 };
  private socket: Socket | null = null;
  readonly stats = { answered: 0, dropped: 0, malformed: 0 };

  constructor(
    private readonly zone: LeakZone,
    { maxPacketBytes = 1_232, maxQueriesPerSecond = 200 }: DnsServerLimits = {},
    private readonly now: () => number = Date.now,
  ) {
    this.maxPacketBytes = maxPacketBytes;
    this.maxQueriesPerSecond = maxQueriesPerSecond;
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
        resolve(socket.address().port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => (this.socket ? this.socket.close(() => resolve()) : resolve()));
  }

  /** The answer for one datagram, or null to stay silent. Public for tests that skip the socket. */
  respond(msg: Buffer, from: string): Buffer | null {
    if (msg.length > this.maxPacketBytes || !this.admit()) {
      this.stats.dropped++;
      return null;
    }
    try {
      const query = parseQuery(msg);
      this.stats.answered++;
      return writeAnswer(query, this.zone.answer(query, from));
    } catch (err) {
      if (!(err instanceof BadMessage)) throw err;
      this.stats.malformed++;
      return formatError(msg);
    }
  }

  private handle(socket: Socket, msg: Buffer, rinfo: RemoteInfo) {
    const reply = this.respond(msg, rinfo.address.replace(/^::ffff:/, ""));
    if (reply) socket.send(reply, rinfo.port, rinfo.address);
  }

  private admit(): boolean {
    const second = Math.floor(this.now() / 1_000);
    if (second !== this.window.second) this.window = { second, count: 0 };
    return ++this.window.count <= this.maxQueriesPerSecond;
  }
}
