// STUN wire format (RFC 8489), only as much as a server answering Binding requests needs:
// read a request and write back the transport address the request came from.

export const MAGIC_COOKIE = 0x2112a442;
export const HEADER_BYTES = 20;

export const METHOD = { BINDING: 0x001 } as const;
/** The two class bits of the message type: request, indication, success response, error response. */
export const CLASS = { REQUEST: 0b00, INDICATION: 0b01, SUCCESS: 0b10, ERROR: 0b11 } as const;

export const ATTR = {
  MAPPED_ADDRESS: 0x0001,
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  UNKNOWN_ATTRIBUTES: 0x000a,
  XOR_MAPPED_ADDRESS: 0x0020,
  PRIORITY: 0x0024,
  USE_CANDIDATE: 0x0025,
  SOFTWARE: 0x8022,
  FINGERPRINT: 0x8028,
  ICE_CONTROLLED: 0x8029,
  ICE_CONTROLLING: 0x802a,
  RESPONSE_ORIGIN: 0x802b,
  OTHER_ADDRESS: 0x802c,
} as const;

/**
 * Comprehension-required attributes (0x0000-0x7fff) this server knows to ignore: an ICE agent that
 * aims a connectivity check at us sends them. Anything else in that range earns a 420, as RFC 8489
 * asks; above it, unknown attributes are ignored silently.
 */
const IGNORED_REQUIRED = new Set<number>([
  ATTR.MAPPED_ADDRESS,
  ATTR.USERNAME,
  ATTR.MESSAGE_INTEGRITY,
  ATTR.XOR_MAPPED_ADDRESS,
  ATTR.PRIORITY,
  ATTR.USE_CANDIDATE,
]);

export class BadMessage extends Error {}

export interface Attribute {
  type: number;
  value: Buffer;
}

export interface StunMessage {
  method: number;
  class: number;
  transactionId: Buffer; // 12 bytes
  attributes: Attribute[];
  /** Comprehension-required attributes this server does not understand, for the 420 response. */
  unknownRequired: number[];
}

export interface TransportAddress {
  address: string;
  port: number;
}

export function messageType(method: number, cls: number): number {
  // The method bits are split around the two class bits (RFC 8489, figure 3).
  return ((method & 0xf80) << 2) | ((method & 0x70) << 1) | (method & 0xf) | ((cls & 0b10) << 7) | ((cls & 0b01) << 4);
}

function methodOf(type: number): number {
  return ((type & 0x3e00) >> 2) | ((type & 0x00e0) >> 1) | (type & 0x000f);
}

function classOf(type: number): number {
  return ((type & 0x0100) >> 7) | ((type & 0x0010) >> 4);
}

/** Reads a message, or throws BadMessage when it is not one. Attribute values are not copied. */
export function parseMessage(buf: Buffer): StunMessage {
  if (buf.length < HEADER_BYTES) throw new BadMessage("shorter than a STUN header");
  if (buf[0] & 0xc0) throw new BadMessage("the two most significant bits are not zero");
  const type = buf.readUInt16BE(0);
  const length = buf.readUInt16BE(2);
  if (buf.readUInt32BE(4) !== MAGIC_COOKIE) throw new BadMessage("no magic cookie");
  if (length % 4) throw new BadMessage("the length is not a multiple of four");
  if (HEADER_BYTES + length > buf.length) throw new BadMessage("the attributes end early");

  const attributes: Attribute[] = [];
  const unknownRequired: number[] = [];
  const end = HEADER_BYTES + length;
  let at = HEADER_BYTES;
  while (at + 4 <= end) {
    const attrType = buf.readUInt16BE(at);
    const attrLength = buf.readUInt16BE(at + 2);
    const from = at + 4;
    if (from + attrLength > end) throw new BadMessage("an attribute ends early");
    attributes.push({ type: attrType, value: buf.subarray(from, from + attrLength) });
    if (attrType < 0x8000 && !IGNORED_REQUIRED.has(attrType)) unknownRequired.push(attrType);
    at = from + attrLength + ((4 - (attrLength % 4)) % 4);
  }
  if (at !== end) throw new BadMessage("an attribute ends early");

  return {
    method: methodOf(type),
    class: classOf(type),
    transactionId: buf.subarray(8, 20),
    attributes,
    unknownRequired,
  };
}

export function findAttribute(message: StunMessage, type: number): Buffer | null {
  return message.attributes.find((a) => a.type === type)?.value ?? null;
}

export interface WriteOptions {
  method?: number;
  class: number;
  transactionId: Buffer;
  attributes: Attribute[];
  fingerprint?: boolean; // appends FINGERPRINT (RFC 8489, section 14.7), which browsers check
}

export function writeMessage(options: WriteOptions): Buffer {
  const { method = METHOD.BINDING, class: cls, transactionId, attributes, fingerprint = true } = options;
  const body = Buffer.concat(attributes.map(writeAttribute));
  // The length the fingerprint is computed over already counts the fingerprint attribute itself.
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt16BE(messageType(method, cls), 0);
  header.writeUInt16BE(body.length + (fingerprint ? 8 : 0), 2);
  header.writeUInt32BE(MAGIC_COOKIE, 4);
  transactionId.copy(header, 8);
  const message = Buffer.concat([header, body]);
  if (!fingerprint) return message;
  const value = Buffer.alloc(4);
  value.writeUInt32BE((crc32(message) ^ 0x5354554e) >>> 0);
  return Buffer.concat([message, writeAttribute({ type: ATTR.FINGERPRINT, value })]);
}

function writeAttribute({ type, value }: Attribute): Buffer {
  const padding = (4 - (value.length % 4)) % 4;
  const buf = Buffer.alloc(4 + value.length + padding);
  buf.writeUInt16BE(type, 0);
  buf.writeUInt16BE(value.length, 2);
  value.copy(buf, 4);
  return buf;
}

export const attr = {
  /** XOR-MAPPED-ADDRESS: the address we saw, masked so middleboxes rewriting addresses miss it. */
  xorMappedAddress(address: TransportAddress, transactionId: Buffer): Attribute {
    const value = addressValue(address);
    const mask = Buffer.concat([cookieBytes(), transactionId]);
    for (let i = 0; i < value.length - 4; i++) value[4 + i] ^= mask[i];
    value.writeUInt16BE(value.readUInt16BE(2) ^ (MAGIC_COOKIE >>> 16), 2);
    return { type: ATTR.XOR_MAPPED_ADDRESS, value };
  },
  /** RESPONSE-ORIGIN and OTHER-ADDRESS (RFC 5780): which socket answered, and another one to try. */
  responseOrigin(address: TransportAddress): Attribute {
    return { type: ATTR.RESPONSE_ORIGIN, value: addressValue(address) };
  },
  otherAddress(address: TransportAddress): Attribute {
    return { type: ATTR.OTHER_ADDRESS, value: addressValue(address) };
  },
  software(text: string): Attribute {
    return { type: ATTR.SOFTWARE, value: Buffer.from(text, "utf8") };
  },
  errorCode(code: number, reason: string): Attribute {
    const text = Buffer.from(reason, "utf8");
    const value = Buffer.alloc(4 + text.length);
    value[2] = Math.floor(code / 100);
    value[3] = code % 100;
    text.copy(value, 4);
    return { type: ATTR.ERROR_CODE, value };
  },
  unknownAttributes(types: number[]): Attribute {
    const value = Buffer.alloc(types.length * 2);
    types.forEach((type, i) => value.writeUInt16BE(type, i * 2));
    return { type: ATTR.UNKNOWN_ATTRIBUTES, value };
  },
};

/** Reads an XOR-MAPPED-ADDRESS value back; null when the family is one nobody defined. */
export function readXorMappedAddress(value: Buffer, transactionId: Buffer): TransportAddress | null {
  if (value.length < 8) return null;
  const size = value[1] === 0x01 ? 4 : value[1] === 0x02 ? 16 : 0;
  if (!size || value.length < 4 + size) return null;
  const bytes = Buffer.from(value.subarray(4, 4 + size));
  const mask = Buffer.concat([cookieBytes(), transactionId]);
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= mask[i];
  return { address: formatAddress(bytes), port: value.readUInt16BE(2) ^ (MAGIC_COOKIE >>> 16) };
}

function cookieBytes(): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(MAGIC_COOKIE);
  return buf;
}

/** The body every address attribute shares: a reserved byte, the family, the port and the address. */
function addressValue({ address, port }: TransportAddress): Buffer {
  const bytes = addressBytes(address);
  if (!bytes) throw new BadMessage(`not an address: ${address}`);
  const value = Buffer.alloc(4 + bytes.length);
  value[1] = bytes.length === 4 ? 0x01 : 0x02;
  value.writeUInt16BE(port, 2);
  Buffer.from(bytes).copy(value, 4);
  return value;
}

/** An address as its 4 or 16 bytes, or null when it is not one. An IPv4-mapped one counts as IPv4. */
export function addressBytes(address: string): number[] | null {
  const plain = address
    .trim()
    .toLowerCase()
    .replace(/%.*$/, "")
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(plain);
  if (v4) {
    const bytes = v4.slice(1).map(Number);
    return bytes.every((b) => b <= 255) ? bytes : null;
  }
  if (!/^[0-9a-f:.]+$/.test(plain)) return null;
  const halves = plain.split("::");
  if (halves.length > 2) return null;
  const head = groupBytes(halves[0]);
  const tail = groupBytes(halves[1] ?? "");
  if (!head || !tail) return null;
  const missing = 8 - head.length / 2 - tail.length / 2;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const gap = halves.length === 1 ? [] : new Array<number>(missing * 2).fill(0);
  return [...head, ...gap, ...tail];
}

/** The 16-bit groups of one side of an IPv6 address as bytes, embedded IPv4 included. */
function groupBytes(part: string): number[] | null {
  if (!part) return [];
  const out: number[] = [];
  for (const piece of part.split(":")) {
    if (piece.includes(".")) {
      const embedded = addressBytes(piece);
      if (!embedded || embedded.length !== 4) return null;
      out.push(...embedded);
    } else {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      const group = parseInt(piece, 16);
      out.push(group >> 8, group & 0xff);
    }
  }
  return out;
}

/** Bytes back to text: a dotted quad for 4, the shortened form for 16. */
export function formatAddress(bytes: Buffer): string {
  if (bytes.length === 4) return Array.from(bytes).join(".");
  const groups = Array.from({ length: 8 }, (_, i) => bytes.readUInt16BE(i * 2));
  let best = { at: -1, length: 0 };
  for (let i = 0; i < 8; i++) {
    if (groups[i]) continue;
    let end = i;
    while (end < 8 && !groups[end]) end++;
    if (end - i > best.length) best = { at: i, length: end - i };
    i = end;
  }
  const text = groups.map((g) => g.toString(16));
  if (best.length < 2) return text.join(":");
  return `${text.slice(0, best.at).join(":")}::${text.slice(best.at + best.length).join(":")}`;
}

// CRC-32 (IEEE, reflected) for FINGERPRINT: a 256-entry table, built once.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
