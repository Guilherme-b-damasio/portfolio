import type { Http2Preface, Http2Priority, Http2Setting } from "../../domain/http2.js";
import { headerNames } from "./hpack.js";

export const CLIENT_PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
export const MAX_PREFACE_BYTES = 64 * 1024; // past this without a full first request, it is not a browser
const MAX_FRAMES = 32;

export class NotHttp2Preface extends Error {}

const FRAME_TYPES = [
  "DATA",
  "HEADERS",
  "PRIORITY",
  "RST_STREAM",
  "SETTINGS",
  "PUSH_PROMISE",
  "PING",
  "GOAWAY",
  "WINDOW_UPDATE",
  "CONTINUATION",
];
const frameType = (t: number) => FRAME_TYPES[t] ?? (t === 0x10 ? "PRIORITY_UPDATE" : `0x${t.toString(16)}`);

const SETTINGS: Record<number, string> = {
  1: "HEADER_TABLE_SIZE",
  2: "ENABLE_PUSH",
  3: "MAX_CONCURRENT_STREAMS",
  4: "INITIAL_WINDOW_SIZE",
  5: "MAX_FRAME_SIZE",
  6: "MAX_HEADER_LIST_SIZE",
  8: "ENABLE_CONNECT_PROTOCOL",
  9: "NO_RFC7540_PRIORITIES",
};

const HEADERS = 0x1;
const CONTINUATION = 0x9;
const END_HEADERS = 0x4;
const PADDED = 0x8;
const PRIORITY_FLAG = 0x20;
const ACK = 0x1;

interface RawFrame {
  type: number;
  flags: number;
  stream: number;
  payload: Buffer;
}

/** Walks whole frames after the preface, stopping once the first request's header block is complete. */
function* frames(buf: Buffer): Generator<RawFrame | { missing: number }> {
  let pos = CLIENT_PREFACE.length;
  let count = 0;
  let inHeaders = false;
  for (;;) {
    if (pos + 9 > buf.length) return yield { missing: pos + 9 - buf.length };
    const length = buf.readUIntBE(pos, 3);
    const end = pos + 9 + length;
    if (end > MAX_PREFACE_BYTES || ++count > MAX_FRAMES) throw new NotHttp2Preface("no request in sight");
    if (end > buf.length) return yield { missing: end - buf.length };
    const frame = {
      type: buf[pos + 3],
      flags: buf[pos + 4],
      stream: buf.readUInt32BE(pos + 5) & 0x7fffffff,
      payload: buf.subarray(pos + 9, end),
    };
    if (inHeaders && frame.type !== CONTINUATION) throw new NotHttp2Preface("header block interrupted");
    yield frame;
    pos = end;
    if (frame.type === HEADERS || frame.type === CONTINUATION) {
      inHeaders = !(frame.flags & END_HEADERS);
      if (!inHeaders) return yield { missing: 0 };
    }
  }
}

/**
 * How many more bytes the client preface and its first request's headers need (0 when complete).
 * Throws as soon as the bytes can't be HTTP/2 from a client, so the caller can stop waiting.
 */
export function prefaceBytesMissing(buf: Buffer): number {
  const head = buf.subarray(0, CLIENT_PREFACE.length);
  if (!head.equals(CLIENT_PREFACE.subarray(0, head.length))) throw new NotHttp2Preface("not the HTTP/2 client preface");
  if (head.length < CLIENT_PREFACE.length) return CLIENT_PREFACE.length - head.length;
  for (const f of frames(buf)) if ("missing" in f) return f.missing;
  return 0;
}

const priority = (stream: number, p: Buffer): Http2Priority => {
  if (p.length < 5) throw new NotHttp2Preface("short priority block");
  const dep = p.readUInt32BE(0);
  return { stream, exclusive: (dep & 0x80000000) !== 0, dependsOn: dep & 0x7fffffff, weight: p[4] + 1 };
};

/** Reads the settings, window update, priorities and pseudo-header order a client opened with. */
export function parseHttp2Preface(buf: Buffer): Http2Preface {
  if (prefaceBytesMissing(buf) > 0) throw new NotHttp2Preface("incomplete preface");
  const out: Http2Preface = {
    settings: [],
    windowUpdate: null,
    priorities: [],
    headerPriority: null,
    pseudoHeaders: [],
    frames: [],
    bytes: 0,
  };
  const block: Buffer[] = [];
  let size = CLIENT_PREFACE.length;
  for (const f of frames(buf)) {
    if ("missing" in f) break;
    size += 9 + f.payload.length;
    out.frames.push({ type: frameType(f.type), stream: f.stream, length: f.payload.length, flags: f.flags });
    switch (f.type) {
      case 0x4: // SETTINGS; an ACK carries none
        if (f.flags & ACK) break;
        for (let i = 0; i + 6 <= f.payload.length; i += 6) {
          const id = f.payload.readUInt16BE(i);
          const setting: Http2Setting = {
            id,
            name: SETTINGS[id] ?? `0x${id.toString(16)}`,
            value: f.payload.readUInt32BE(i + 2),
          };
          out.settings.push(setting);
        }
        break;
      case 0x8: // WINDOW_UPDATE; only the connection's counts, a stream's is per request
        if (f.stream === 0 && out.windowUpdate === null && f.payload.length >= 4)
          out.windowUpdate = f.payload.readUInt32BE(0) & 0x7fffffff;
        break;
      case 0x2:
        out.priorities.push(priority(f.stream, f.payload));
        break;
      case HEADERS: {
        let p = f.payload;
        let pad = 0;
        if (f.flags & PADDED) {
          pad = p[0] ?? 0;
          p = p.subarray(1);
        }
        if (f.flags & PRIORITY_FLAG) {
          out.headerPriority = priority(f.stream, p);
          p = p.subarray(5);
        }
        if (pad > p.length) throw new NotHttp2Preface("padding longer than the frame");
        block.push(p.subarray(0, p.length - pad));
        break;
      }
      case CONTINUATION:
        block.push(f.payload);
        break;
    }
  }
  // Pseudo-headers come first (RFC 9113, 8.3); a Huffman-coded name can't be one we know, so it ends the run too.
  for (const name of headerNames(Buffer.concat(block))) {
    if (!name?.startsWith(":")) break;
    out.pseudoHeaders.push(name);
  }
  out.bytes = size;
  return out;
}
