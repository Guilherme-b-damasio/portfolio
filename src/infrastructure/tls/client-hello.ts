import type { ClientHello, HelloField } from "../../domain/tls.js";
import { isGrease } from "../../domain/tls.js";
import { extensionName } from "./names.js";

export const MAX_HELLO_BYTES = 16 * 1024; // a ClientHello bigger than this is not a browser's, and we stop reading
const HEX_CAP = 4096;

export class NotClientHello extends Error {}

/**
 * How many more bytes a complete ClientHello needs, judging by what has arrived so far
 * (0 when complete). Throws as soon as the bytes can't be a ClientHello, so the caller can stop reading.
 */
export function bytesMissing(buf: Buffer): number {
  if (buf.length >= 1 && buf[0] !== 0x16) throw new NotClientHello("not a TLS handshake record");
  if (buf.length < 9) return 9 - buf.length;
  if (buf[5] !== 0x01) throw new NotClientHello("handshake is not a ClientHello");
  const needed = 4 + buf.readUIntBE(6, 3);
  if (needed > MAX_HELLO_BYTES) throw new NotClientHello("ClientHello too large");
  // The handshake may span several records: count payload bytes, skipping each 5-byte record header.
  let have = 0;
  let pos = 0;
  while (have < needed) {
    if (pos + 5 > buf.length) return pos + 5 - buf.length + (needed - have);
    if (buf[pos] !== 0x16) throw new NotClientHello("unexpected record type");
    const len = buf.readUInt16BE(pos + 3);
    const available = Math.min(len, buf.length - pos - 5);
    have += available;
    if (available < len) return len - available;
    pos += 5 + len;
  }
  return 0;
}

/** Joins the payload of consecutive handshake records into one buffer. */
function handshakeBytes(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let pos = 0;
  while (pos + 5 <= buf.length && buf[pos] === 0x16) {
    const len = buf.readUInt16BE(pos + 3);
    parts.push(buf.subarray(pos + 5, Math.min(buf.length, pos + 5 + len)));
    pos += 5 + len;
  }
  return Buffer.concat(parts);
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

/** A bounds-checked reader: a truncated or lying length field throws instead of reading garbage. */
class Reader {
  constructor(
    private readonly buf: Buffer,
    public pos = 0,
  ) {}
  private need(n: number) {
    if (this.pos + n > this.buf.length) throw new NotClientHello("truncated ClientHello");
  }
  u8() {
    this.need(1);
    return this.buf[this.pos++];
  }
  u16() {
    this.need(2);
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  u24() {
    this.need(3);
    const v = this.buf.readUIntBE(this.pos, 3);
    this.pos += 3;
    return v;
  }
  bytes(n: number) {
    this.need(n);
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  u16List(lengthBytes: 1 | 2): string[] {
    const len = lengthBytes === 1 ? this.u8() : this.u16();
    const end = this.pos + len;
    const out: string[] = [];
    while (this.pos + 2 <= end) out.push(hex4(this.u16()));
    this.pos = end;
    return out;
  }
}

/** Parses the TLS records that carry a ClientHello. Offsets in `fields` are relative to the first record. */
export function parseClientHello(raw: Buffer): ClientHello {
  if (bytesMissing(raw) > 0) throw new NotClientHello("incomplete ClientHello");
  const body = handshakeBytes(raw);
  // Offsets point into the bytes as sent: past the 5-byte record header. Exact for single-record hellos (every browser's).
  const at = (p: number) => 5 + p;
  const fields: HelloField[] = [
    { offset: 0, length: 5, label: "record header", kind: "record" },
    { offset: at(0), length: 4, label: "handshake header", kind: "handshake" },
  ];
  const r = new Reader(body);
  r.u8(); // handshake type, checked by bytesMissing
  r.u24();

  const legacyVersion = hex4(r.u16());
  fields.push({ offset: at(4), length: 2, label: `legacy_version ${legacyVersion}`, kind: "version" });
  r.bytes(32);
  fields.push({ offset: at(6), length: 32, label: "random", kind: "random" });

  const sidStart = r.pos;
  r.bytes(r.u8());
  fields.push({ offset: at(sidStart), length: r.pos - sidStart, label: "session_id", kind: "session" });

  const csStart = r.pos;
  const ciphers = r.u16List(2);
  fields.push({
    offset: at(csStart),
    length: r.pos - csStart,
    label: `cipher_suites (${ciphers.length})`,
    kind: "ciphers",
  });

  const compStart = r.pos;
  r.bytes(r.u8());
  fields.push({ offset: at(compStart), length: r.pos - compStart, label: "compression", kind: "compression" });

  const hello: ClientHello = {
    legacyVersion,
    supportedVersions: [],
    sni: null,
    alpn: [],
    ciphers,
    extensions: [],
    signatureAlgorithms: [],
    groups: [],
    keyShareGroups: [],
    bytes: raw.length,
    hex: raw.subarray(0, HEX_CAP).toString("hex"),
    fields,
  };
  if (r.pos >= body.length) return hello; // TLS 1.0-era hellos may have no extensions at all

  const extStart = r.pos;
  const extEnd = r.pos + 2 + r.u16();
  fields.push({ offset: at(extStart), length: 2, label: "extensions length", kind: "handshake" });
  while (r.pos + 4 <= Math.min(extEnd, body.length)) {
    const start = r.pos;
    const type = hex4(r.u16());
    const data = r.bytes(r.u16());
    hello.extensions.push(type);
    fields.push({
      offset: at(start),
      length: r.pos - start,
      label: isGrease(type) ? `GREASE ${type}` : `ext ${extensionName(type)}`,
      kind: isGrease(type) ? "grease" : "extension",
    });
    readExtension(type, data, hello);
  }
  return hello;
}

function readExtension(type: string, data: Buffer, hello: ClientHello) {
  const r = new Reader(data);
  try {
    switch (type) {
      case "0000": {
        // server_name_list: one host_name entry in practice
        r.u16();
        if (r.u8() === 0) hello.sni = r.bytes(r.u16()).toString("latin1");
        break;
      }
      case "0010": {
        const end = 2 + r.u16();
        while (r.pos < end) hello.alpn.push(r.bytes(r.u8()).toString("latin1"));
        break;
      }
      case "002b":
        hello.supportedVersions = r.u16List(1);
        break;
      case "000d":
        hello.signatureAlgorithms = r.u16List(2);
        break;
      case "000a":
        hello.groups = r.u16List(2);
        break;
      case "0033": {
        const end = 2 + r.u16();
        while (r.pos < end) {
          hello.keyShareGroups.push(hex4(r.u16()));
          r.bytes(r.u16());
        }
        break;
      }
    }
  } catch {
    // A malformed extension body still counts as present; its details are just left out.
  }
}
