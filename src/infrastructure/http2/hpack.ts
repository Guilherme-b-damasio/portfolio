// Just enough HPACK (RFC 7541) to read which names a header block carries, in order.
// Values are skipped, never decoded: the fingerprint only needs the pseudo-header order, and the
// regular headers reach the app already parsed by Node.

// Names of the static table (RFC 7541, Appendix A), index 1 to 61.
const STATIC_NAMES = [
  ":authority",
  ":method",
  ":method",
  ":path",
  ":path",
  ":scheme",
  ":scheme",
  ":status",
  ":status",
  ":status",
  ":status",
  ":status",
  ":status",
  ":status",
  "accept-charset",
  "accept-encoding",
  "accept-language",
  "accept-ranges",
  "accept",
  "access-control-allow-origin",
  "age",
  "allow",
  "authorization",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-location",
  "content-range",
  "content-type",
  "cookie",
  "date",
  "etag",
  "expect",
  "expires",
  "from",
  "host",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "if-unmodified-since",
  "last-modified",
  "link",
  "location",
  "max-forwards",
  "proxy-authenticate",
  "proxy-authorization",
  "range",
  "referer",
  "refresh",
  "retry-after",
  "server",
  "set-cookie",
  "strict-transport-security",
  "transfer-encoding",
  "user-agent",
  "vary",
  "via",
  "www-authenticate",
];

export class HpackError extends Error {}

class Reader {
  pos = 0;
  constructor(private readonly buf: Buffer) {}
  get done() {
    return this.pos >= this.buf.length;
  }
  peek() {
    if (this.done) throw new HpackError("truncated header block");
    return this.buf[this.pos];
  }
  /** An HPACK integer with an N-bit prefix (RFC 7541, 5.1). */
  int(prefixBits: number): number {
    const max = (1 << prefixBits) - 1;
    let value = this.peek() & max;
    this.pos++;
    if (value < max) return value;
    for (let shift = 0; ; shift += 7) {
      if (shift > 21) throw new HpackError("integer too large");
      const b = this.peek();
      this.pos++;
      value += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) return value;
    }
  }
  /** A string literal: its text when sent raw, null when Huffman-coded (we don't carry the code table). */
  string(): string | null {
    const huffman = (this.peek() & 0x80) !== 0;
    const len = this.int(7);
    if (this.pos + len > this.buf.length) throw new HpackError("truncated string");
    const s = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return huffman ? null : s.toString("latin1");
  }
}

/**
 * The header names in a block, in order; null for a name that was sent as a Huffman-coded literal.
 * The dynamic table starts empty, as it does in a connection's first request, and only grows here:
 * eviction would need the decoded value sizes, and a first request never fills 4 KB of table.
 */
export function headerNames(block: Buffer): (string | null)[] {
  const r = new Reader(block);
  const dynamic: (string | null)[] = []; // most recent first, as index 62 onwards
  const nameAt = (index: number): string | null => {
    if (index >= 1 && index <= STATIC_NAMES.length) return STATIC_NAMES[index - 1];
    const d = index - STATIC_NAMES.length - 1;
    if (d >= 0 && d < dynamic.length) return dynamic[d];
    throw new HpackError(`index ${index} out of range`);
  };
  const names: (string | null)[] = [];
  while (!r.done) {
    const b = r.peek();
    if (b & 0x80) {
      names.push(nameAt(r.int(7))); // indexed field
    } else if ((b & 0xe0) === 0x20) {
      r.int(5); // dynamic table size update
    } else {
      const incremental = (b & 0xc0) === 0x40;
      const index = r.int(incremental ? 6 : 4);
      const name = index ? nameAt(index) : r.string();
      r.string(); // the value
      names.push(name);
      if (incremental) dynamic.unshift(name);
    }
  }
  return names;
}
