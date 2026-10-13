import net from "node:net";

// PROXY protocol (HAProxy spec, v1 and v2): a TCP proxy that can't add an X-Forwarded-For header,
// because it never decrypts the stream, prefixes the connection with the client's real address.

const V2_SIGNATURE = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a]);
const V1_MAX = 107; // the longest legal v1 line, CRLF included

export class BadProxyHeader extends Error {}

export type ProxyHeader =
  | { complete: false }
  // client is null for LOCAL (v2) and UNKNOWN (v1): the proxy's own health checks.
  | { complete: true; length: number; client: { address: string; port: number } | null };

/** Reads a PROXY header off the start of a connection. Throws if the bytes can't be one. */
export function readProxyHeader(buf: Buffer): ProxyHeader {
  const head = buf.subarray(0, V2_SIGNATURE.length);
  if (V2_SIGNATURE.subarray(0, head.length).equals(head)) {
    return head.length < V2_SIGNATURE.length ? { complete: false } : readV2(buf);
  }
  // "PROXY " or the start of it: a v1 line still arriving.
  if ("PROXY ".startsWith(buf.subarray(0, 6).toString("latin1"))) return readV1(buf);
  throw new BadProxyHeader("connection does not start with a PROXY header");
}

function readV1(buf: Buffer): ProxyHeader {
  const end = buf.indexOf("\r\n");
  if (end === -1) {
    if (buf.length >= V1_MAX) throw new BadProxyHeader("v1 header too long");
    return { complete: false };
  }
  const parts = buf.subarray(0, end).toString("latin1").split(" ");
  const length = end + 2;
  if (parts[0] !== "PROXY") throw new BadProxyHeader("bad v1 header");
  if (parts[1] === "UNKNOWN") return { complete: true, length, client: null };
  const [, family, source, , sourcePort] = parts;
  const port = Number(sourcePort);
  const version = family === "TCP4" ? 4 : family === "TCP6" ? 6 : 0;
  if (parts.length !== 6 || net.isIP(source) !== version || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new BadProxyHeader("bad v1 address");
  }
  return { complete: true, length, client: { address: source, port } };
}

function readV2(buf: Buffer): ProxyHeader {
  if (buf.length < 16) return { complete: false };
  const versionCommand = buf[12];
  if (versionCommand >> 4 !== 2) throw new BadProxyHeader("unsupported v2 version");
  const length = 16 + buf.readUInt16BE(14);
  if (buf.length < length) return { complete: false };
  const command = versionCommand & 0x0f;
  if (command === 0x0) return { complete: true, length, client: null }; // LOCAL
  if (command !== 0x1) throw new BadProxyHeader("unsupported v2 command");

  const family = buf[13];
  if (family === 0x11 && length >= 16 + 12) {
    const address = [...buf.subarray(16, 20)].join(".");
    return { complete: true, length, client: { address, port: buf.readUInt16BE(24) } };
  }
  if (family === 0x21 && length >= 16 + 36) {
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(buf.readUInt16BE(16 + i).toString(16));
    // The URL parser writes IPv6 in its canonical, compressed form.
    const address = new URL(`http://[${groups.join(":")}]/`).hostname.slice(1, -1);
    return { complete: true, length, client: { address, port: buf.readUInt16BE(48) } };
  }
  // UDP, UNIX sockets or an unspecified family: the proxy says nothing usable about the client.
  return { complete: true, length, client: null };
}
