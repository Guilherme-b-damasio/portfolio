import type { ClientSubnet } from "../../domain/dns-leak.js";

// DNS wire format (RFC 1035), only as much as an authoritative server for one small zone needs:
// read a query, with its EDNS options (RFC 6891, 7871), and write an answer to it.

export const TYPE = { A: 1, NS: 2, SOA: 6, TXT: 16, AAAA: 28, OPT: 41, ANY: 255 } as const;
export const RCODE = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 } as const;
export const CLASS_IN = 1;
const OPTION_CLIENT_SUBNET = 8;

const typeNames = new Map<number, string>(Object.entries(TYPE).map(([name, code]) => [code, name]));

/** "A", "AAAA"... or "TYPE65" for the ones without a name here (RFC 3597). */
export function typeName(code: number): string {
  return typeNames.get(code) ?? `TYPE${code}`;
}

export class BadMessage extends Error {}

export interface Question {
  labels: string[]; // as sent: resolvers randomise the case (0x20) and expect it back unchanged
  type: number;
  class: number;
}

export interface Query {
  id: number;
  opcode: number;
  recursionDesired: boolean;
  question: Question;
  edns: { udpSize: number; clientSubnet: ClientSubnet | null } | null;
}

export interface ResourceRecord {
  labels: string[];
  type: number;
  ttl: number;
  data: Buffer;
}

export interface Answer {
  rcode: number;
  authoritative: boolean;
  answers?: ResourceRecord[];
  authority?: ResourceRecord[];
}

class Reader {
  offset = 0;

  constructor(readonly buf: Buffer) {}

  need(n: number) {
    if (this.offset + n > this.buf.length) throw new BadMessage("message ends early");
  }

  u8() {
    this.need(1);
    return this.buf[this.offset++];
  }

  u16() {
    this.need(2);
    const v = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }

  u32() {
    this.need(4);
    const v = this.buf.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  bytes(n: number) {
    this.need(n);
    const v = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  /** A name, following compression pointers backwards only, so a crafted packet cannot loop. */
  name(): string[] {
    const labels: string[] = [];
    let at = this.offset;
    let jumped = false;
    let length = 0;
    for (;;) {
      if (at >= this.buf.length) throw new BadMessage("name runs past the message");
      const len = this.buf[at];
      if ((len & 0xc0) === 0xc0) {
        if (at + 1 >= this.buf.length) throw new BadMessage("pointer runs past the message");
        const target = ((len & 0x3f) << 8) | this.buf[at + 1];
        if (target >= at) throw new BadMessage("pointer does not point backwards");
        if (!jumped) this.offset = at + 2;
        jumped = true;
        at = target;
        continue;
      }
      if (len & 0xc0) throw new BadMessage("unknown label type");
      if (len === 0) {
        if (!jumped) this.offset = at + 1;
        return labels;
      }
      length += len + 1;
      if (length > 254) throw new BadMessage("name longer than 255 bytes");
      if (at + 1 + len > this.buf.length) throw new BadMessage("label runs past the message");
      labels.push(this.buf.toString("latin1", at + 1, at + 1 + len));
      at += 1 + len;
    }
  }
}

function clientSubnet(data: Buffer): ClientSubnet | null {
  if (data.length < 4) return null;
  const family = data.readUInt16BE(0);
  const prefix = data[2];
  const bytes = data.subarray(4);
  const size = family === 1 ? 4 : family === 2 ? 16 : 0;
  if (!size || prefix > size * 8 || bytes.length !== Math.ceil(prefix / 8)) return null;
  const full = Buffer.alloc(size);
  bytes.copy(full);
  if (family === 1) return { family: 4, address: [...full].join("."), prefix };
  return { family: 6, address: formatIpv6(full), prefix };
}

/** RFC 5952 text form: lowercase, the longest run of two or more zero groups shortened to "::". */
export function formatIpv6(bytes: Buffer): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(bytes.readUInt16BE(i));
  let [best, bestLen] = [-1, 1];
  for (let i = 0; i < 8;) {
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) [best, bestLen] = [i, j - i];
    i = j > i ? j : i + 1;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best < 0) return hex.join(":");
  return `${hex.slice(0, best).join(":")}::${hex.slice(best + bestLen).join(":")}`;
}

function edns(data: Buffer, udpSize: number) {
  const r = new Reader(data);
  let subnet: ClientSubnet | null = null;
  while (r.offset < data.length) {
    const code = r.u16();
    const value = r.bytes(r.u16());
    if (code === OPTION_CLIENT_SUBNET) subnet = clientSubnet(value);
  }
  return { udpSize, clientSubnet: subnet };
}

/** Reads a query. Throws BadMessage on anything that is not a well-formed one-question query. */
export function parseQuery(buf: Buffer): Query {
  const r = new Reader(buf);
  const id = r.u16();
  const flags = r.u16();
  if (flags & 0x8000) throw new BadMessage("a response, not a query");
  const [qd, an, ns, ar] = [r.u16(), r.u16(), r.u16(), r.u16()];
  if (qd !== 1) throw new BadMessage(`expected one question, got ${qd}`);
  const question = { labels: r.name(), type: r.u16(), class: r.u16() };
  let ednsPart: Query["edns"] = null;
  for (let i = 0; i < an + ns + ar; i++) {
    r.name();
    const type = r.u16();
    const cls = r.u16();
    r.u32();
    const data = r.bytes(r.u16());
    if (type === TYPE.OPT && i >= an + ns) ednsPart = edns(data, cls);
  }
  return { id, opcode: (flags >> 11) & 0xf, recursionDesired: Boolean(flags & 0x0100), question, edns: ednsPart };
}

function writeName(labels: string[]): Buffer {
  const parts = labels.map((l) => {
    const label = Buffer.from(l, "latin1");
    return Buffer.concat([Buffer.from([label.length]), label]);
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

function writeRecord({ labels, type, ttl, data }: ResourceRecord): Buffer {
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(type, 0);
  fixed.writeUInt16BE(CLASS_IN, 2);
  fixed.writeUInt32BE(ttl, 4);
  fixed.writeUInt16BE(data.length, 8);
  return Buffer.concat([writeName(labels), fixed, data]);
}

/** The OPT record of the answer: our UDP size, and the client subnet echoed with scope 0 (RFC 7871 §7.2.1). */
function writeOpt(query: Query): Buffer {
  let options = Buffer.alloc(0);
  const subnet = query.edns?.clientSubnet;
  if (subnet) {
    const address =
      subnet.family === 4 ? Buffer.from(subnet.address.split(".").map(Number)) : ipv6Bytes(subnet.address);
    const head = Buffer.from([0, OPTION_CLIENT_SUBNET, 0, 0, 0, subnet.family === 4 ? 1 : 2, subnet.prefix, 0]);
    const body = address.subarray(0, Math.ceil(subnet.prefix / 8));
    head.writeUInt16BE(4 + body.length, 2);
    options = Buffer.concat([head, body]);
  }
  const fixed = Buffer.alloc(11);
  fixed[0] = 0; // root name
  fixed.writeUInt16BE(TYPE.OPT, 1);
  fixed.writeUInt16BE(1232, 3); // the size that avoids IP fragmentation (DNS flag day 2020)
  fixed.writeUInt32BE(0, 5);
  fixed.writeUInt16BE(options.length, 9);
  return Buffer.concat([fixed, options]);
}

export function ipv6Bytes(address: string): Buffer {
  const halves = address.split("::");
  if (halves.length > 2) throw new BadMessage("bad IPv6");
  const [head, tail] = halves.length === 2 ? halves : [address, null];
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === null ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) throw new BadMessage("bad IPv6");
  const buf = Buffer.alloc(16);
  groups.forEach((g, i) => buf.writeUInt16BE(parseInt(g, 16), i * 2));
  return buf;
}

/** Writes the answer to a query: header, the question as it came, then the records. */
export function writeAnswer(query: Query, answer: Answer): Buffer {
  const answers = answer.answers ?? [];
  const authority = answer.authority ?? [];
  const header = Buffer.alloc(12);
  header.writeUInt16BE(query.id, 0);
  let flags = 0x8000 | (query.opcode << 11) | (answer.rcode & 0xf);
  if (answer.authoritative) flags |= 0x0400;
  if (query.recursionDesired) flags |= 0x0100;
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answers.length, 6);
  header.writeUInt16BE(authority.length, 8);
  header.writeUInt16BE(query.edns ? 1 : 0, 10);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(query.question.type, 0);
  question.writeUInt16BE(query.question.class, 2);
  return Buffer.concat([
    header,
    writeName(query.question.labels),
    question,
    ...answers.map(writeRecord),
    ...authority.map(writeRecord),
    ...(query.edns ? [writeOpt(query)] : []),
  ]);
}

/** The answer to a packet that could not be read: FORMERR with the id, when there was one. */
export function formatError(buf: Buffer): Buffer | null {
  if (buf.length < 12 || buf[2] & 0x80) return null;
  const header = Buffer.alloc(12);
  buf.copy(header, 0, 0, 2);
  header.writeUInt16BE(0x8000 | RCODE.FORMERR, 2);
  return header;
}

export const rdata = {
  a: (address: string) => Buffer.from(address.split(".").map(Number)),
  aaaa: (address: string) => ipv6Bytes(address),
  ns: (labels: string[]) => writeName(labels),
  soa(mname: string[], rname: string[], serial: number, negativeTtl: number) {
    const timers = Buffer.alloc(20);
    [serial, 3600, 600, 86_400, negativeTtl].forEach((v, i) => timers.writeUInt32BE(v, i * 4));
    return Buffer.concat([writeName(mname), writeName(rname), timers]);
  },
};
