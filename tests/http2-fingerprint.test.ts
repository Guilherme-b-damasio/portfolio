import http2 from "node:http2";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { akamaiString, http2Fingerprint } from "../src/infrastructure/http2/akamai.js";
import { HpackError, headerNames } from "../src/infrastructure/http2/hpack.js";
import {
  CLIENT_PREFACE,
  NotHttp2Preface,
  parseHttp2Preface,
  prefaceBytesMissing,
} from "../src/infrastructure/http2/preface.js";

const frame = (type: number, flags: number, stream: number, payload: Buffer) => {
  const head = Buffer.alloc(9);
  head.writeUIntBE(payload.length, 0, 3);
  head[3] = type;
  head[4] = flags;
  head.writeUInt32BE(stream, 5);
  return Buffer.concat([head, payload]);
};
const settings = (...pairs: [number, number][]) => {
  const p = Buffer.alloc(pairs.length * 6);
  pairs.forEach(([id, v], i) => {
    p.writeUInt16BE(id, i * 6);
    p.writeUInt32BE(v, i * 6 + 2);
  });
  return frame(0x4, 0, 0, p);
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const raw = (s: string) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s, "latin1")]);

// Chrome's first request: :method GET, :authority (literal, indexed name), :scheme https, :path /,
// then sec-ch-ua as a Huffman-coded literal name, as Chromium sends it.
const chromeBlock = Buffer.concat([
  Buffer.from([0x82, 0x41]),
  raw("localhost"),
  Buffer.from([0x87, 0x84, 0x40, 0x85, 1, 2, 3, 4, 5]),
  raw("x"),
  Buffer.from([0xbe]), // index 62: the entry just added
]);
const chrome = Buffer.concat([
  CLIENT_PREFACE,
  settings([1, 65536], [2, 0], [4, 6291456], [6, 262144]),
  frame(0x8, 0, 0, u32(15663105)),
  // END_STREAM | END_HEADERS | PRIORITY: exclusive on stream 0, weight 256
  frame(0x1, 0x25, 1, Buffer.concat([u32(0x80000000), Buffer.from([255]), chromeBlock])),
]);

describe("HTTP/2 client preface", () => {
  it("reads Chrome's settings, window update and pseudo-header order", () => {
    const p = parseHttp2Preface(chrome);
    expect(p.settings.map((s) => s.name)).toEqual([
      "HEADER_TABLE_SIZE",
      "ENABLE_PUSH",
      "INITIAL_WINDOW_SIZE",
      "MAX_HEADER_LIST_SIZE",
    ]);
    expect(p.windowUpdate).toBe(15663105);
    expect(p.priorities).toEqual([]);
    expect(p.headerPriority).toEqual({ stream: 1, exclusive: true, dependsOn: 0, weight: 256 });
    expect(p.pseudoHeaders).toEqual([":method", ":authority", ":scheme", ":path"]);
    expect(p.frames.map((f) => f.type)).toEqual(["SETTINGS", "WINDOW_UPDATE", "HEADERS"]);
    expect(p.bytes).toBe(chrome.length);
  });

  it("gives Chrome's well-known Akamai fingerprint and hash", () => {
    const fp = http2Fingerprint(parseHttp2Preface(chrome));
    expect(fp.akamai).toBe("1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p");
    expect(fp.hash).toBe("52d84b11737d980aef856699f885ca86");
  });

  it("lists PRIORITY frames the way Firefox used to send them, weight counted from 1", () => {
    const prio = (stream: number, dep: number, weight: number) =>
      frame(0x2, 0, stream, Buffer.concat([u32(dep), Buffer.from([weight - 1])]));
    const block = Buffer.from([0x82, 0x84, 0x41, 0x01, 0x61, 0x87]); // m, p, a, s
    const firefox = Buffer.concat([
      CLIENT_PREFACE,
      settings([1, 65536], [4, 131072], [5, 16384]),
      frame(0x8, 0, 0, u32(12517377)),
      prio(3, 0, 201),
      prio(5, 0, 101),
      frame(0x1, 0x5, 13, block),
    ]);
    expect(akamaiString(parseHttp2Preface(firefox))).toBe(
      "1:65536;4:131072;5:16384|12517377|3:0:0:201,5:0:0:101|m,p,a,s",
    );
  });

  it("follows a header block into CONTINUATION frames and skips padding", () => {
    const block = Buffer.from([0x82, 0x87, 0x84, 0x41, 0x01, 0x61]);
    const padded = Buffer.concat([Buffer.from([3]), block.subarray(0, 2), Buffer.alloc(3)]);
    const buf = Buffer.concat([
      CLIENT_PREFACE,
      settings(),
      frame(0x1, 0x8, 1, padded), // PADDED, no END_HEADERS
      frame(0x9, 0x4, 1, block.subarray(2)),
    ]);
    expect(prefaceBytesMissing(buf)).toBe(0);
    expect(parseHttp2Preface(buf).pseudoHeaders).toEqual([":method", ":scheme", ":path", ":authority"]);
    expect(akamaiString(parseHttp2Preface(buf))).toBe("|00|0|m,s,p,a");
  });

  it("counts what is still missing and rejects what isn't HTTP/2", () => {
    expect(prefaceBytesMissing(chrome.subarray(0, 10))).toBe(CLIENT_PREFACE.length - 10);
    expect(prefaceBytesMissing(chrome.subarray(0, CLIENT_PREFACE.length + 4))).toBe(5);
    expect(prefaceBytesMissing(chrome.subarray(0, chrome.length - 3))).toBe(3);
    expect(() => prefaceBytesMissing(Buffer.from("GET / HTTP/1.1\r\n"))).toThrow(NotHttp2Preface);
    expect(() => parseHttp2Preface(chrome.subarray(0, 40))).toThrow(NotHttp2Preface);
  });

  it("gives up on a client that never sends a request", () => {
    const pings = Array.from({ length: 40 }, () => frame(0x6, 0, 0, Buffer.alloc(8)));
    expect(() => prefaceBytesMissing(Buffer.concat([CLIENT_PREFACE, ...pings]))).toThrow(NotHttp2Preface);
    const header = Buffer.concat([CLIENT_PREFACE, frame(0x0, 0, 1, Buffer.alloc(0))]);
    header.writeUIntBE(70_000, CLIENT_PREFACE.length, 3);
    expect(() => prefaceBytesMissing(header)).toThrow(NotHttp2Preface);
  });

  it("refuses a header block cut by another frame", () => {
    const buf = Buffer.concat([CLIENT_PREFACE, frame(0x1, 0, 1, Buffer.from([0x82])), settings()]);
    expect(() => prefaceBytesMissing(buf)).toThrow(NotHttp2Preface);
  });
});

describe("HPACK header names", () => {
  it("reads multi-byte indexes and dynamic table references", () => {
    // literal with incremental indexing, new raw name; then index 62 refers back to it
    const block = Buffer.concat([
      Buffer.from([0x40]),
      raw("x-a"),
      raw("1"),
      Buffer.from([0xbe, 0x0f, 0x2b]),
      raw("ua"),
    ]);
    expect(headerNames(block)).toEqual(["x-a", "x-a", "user-agent"]); // 0x0f 0x2b = 15 + 43 = index 58
  });

  it("throws on an index past both tables or a truncated string", () => {
    expect(() => headerNames(Buffer.from([0xc0]))).toThrow(HpackError);
    expect(() => headerNames(Buffer.from([0x40, 0x05, 0x61]))).toThrow(HpackError);
  });
});

describe("a real client", () => {
  it("fingerprints Node's own HTTP/2 client (nghttp2) from the bytes it really sent", async () => {
    let buf = Buffer.alloc(0);
    const server = net.createServer();
    const done = new Promise<Buffer>((resolve) =>
      server.on("connection", (socket) =>
        socket.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          if (prefaceBytesMissing(buf) === 0) {
            resolve(buf);
            socket.destroy();
          }
        }),
      ),
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    client.on("error", () => {});
    client.request({ ":path": "/", ":method": "GET" }).on("error", () => {});
    const fp = http2Fingerprint(parseHttp2Preface(await done));
    client.destroy();
    server.close();
    // nghttp2 writes pseudo-headers in the order the caller gave them, unlike every browser.
    expect(fp.preface.pseudoHeaders).toEqual([":path", ":method", ":authority", ":scheme"]);
    expect(fp.akamai.endsWith("|p,m,a,s")).toBe(true);
    expect(fp.preface.frames[0].type).toBe("SETTINGS");
  });
});
