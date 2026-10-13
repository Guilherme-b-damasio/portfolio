import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isGrease } from "../src/domain/tls.js";
import { bytesMissing, NotClientHello, parseClientHello } from "../src/infrastructure/tls/client-hello.js";
import { alpnChars, cipherHash, extensionHash, ja4 } from "../src/infrastructure/tls/ja4.js";
import { cipherName, extensionName, groupName } from "../src/infrastructure/tls/names.js";

// Real ClientHellos captured on 2026-10-13 from clients hitting a local socket (SNI "localhost").
const fixture = (name: string) =>
  Buffer.from(readFileSync(path.join(import.meta.dirname, "fixtures", "client-hellos", `${name}.hex`), "utf8"), "hex");
const chromium = fixture("chromium-152"); // Chromium 152 (Claude desktop / Electron)
const node = fixture("node-openssl"); // Node 26, OpenSSL 3.5
const python = fixture("python-urllib"); // Python 3.14 urllib, OpenSSL 3.0
const schannel = fixture("curl-schannel"); // curl 8.14 on Windows, Schannel

describe("JA4, against the worked example in the FoxIO spec", () => {
  const ciphers = "1301,1302,1303,c02b,c02f,c02c,c030,cca9,cca8,c013,c014,009c,009d,002f,0035".split(",");
  const extensions = "001b,0000,0033,0010,4469,0017,002d,000d,0005,0023,0012,002b,ff01,000b,000a,0015".split(",");
  const sigs = "0403,0804,0401,0503,0805,0501,0806,0601".split(",");

  it("hashes the sorted ciphers", () => {
    expect(cipherHash(ciphers).hash).toBe("8daaf6152771");
    expect(cipherHash([]).hash).toBe("000000000000");
  });

  it("hashes the sorted extensions without SNI and ALPN, then the signature algorithms in order", () => {
    expect(extensionHash(extensions, sigs).hash).toBe("e5627efa2ab1");
    expect(extensionHash(extensions, []).hash).toBe("6d807ffa2a79");
    expect(extensionHash(["0000", "0010"], sigs).hash).toBe("000000000000");
  });

  it("ignores GREASE everywhere, signature algorithms included", () => {
    expect(cipherHash(["0a0a", ...ciphers]).hash).toBe("8daaf6152771");
    expect(extensionHash(["fafa", ...extensions], ["8a8a", ...sigs]).hash).toBe("e5627efa2ab1");
    expect(isGrease("1a1a")).toBe(true);
    expect(isGrease("1a2a")).toBe(false);
  });

  it("takes the ALPN characters as the spec's table says", () => {
    const b = (...bytes: number[]) => Buffer.from(bytes).toString("latin1");
    expect(alpnChars("h2")).toBe("h2");
    expect(alpnChars("http/1.1")).toBe("h1");
    expect(alpnChars(undefined)).toBe("00");
    expect(alpnChars(b(0xab))).toBe("ab");
    expect(alpnChars(b(0x20))).toBe("20");
    expect(alpnChars(b(0xab, 0xcd))).toBe("ad");
    expect(alpnChars(b(0x30, 0xab))).toBe("3b");
    expect(alpnChars(b(0x30, 0x31, 0xab, 0xcd))).toBe("3d");
    expect(alpnChars(b(0x30, 0xab, 0xcd, 0x31))).toBe("01");
  });
});

describe("real handshakes", () => {
  it("fingerprints each TLS stack apart", () => {
    expect(ja4(parseClientHello(chromium)).ja4).toBe("t13d1516h2_8daaf6152771_806a8c22fdea");
    expect(ja4(parseClientHello(node)).ja4).toBe("t13d5212h2_b262b3658495_8e6e362c5eac");
    expect(ja4(parseClientHello(python)).ja4).toBe("t13d1813h1_85036bcba153_d339722ba4af");
    expect(ja4(parseClientHello(schannel)).ja4).toBe("t13d2013h1_2b729b4bf6f3_e24568c0d440");
  });

  it("reads what Chromium sends: GREASE, ALPS, ECH and a post-quantum key share", () => {
    const hello = parseClientHello(chromium);
    expect(hello.sni).toBe("localhost");
    expect(hello.alpn).toEqual(["h2", "http/1.1"]);
    expect(hello.supportedVersions.filter((v) => !isGrease(v))).toEqual(["0304", "0303"]);
    expect(hello.ciphers.some(isGrease)).toBe(true);
    expect(hello.extensions).toEqual(expect.arrayContaining(["44cd", "fe0d"]));
    expect(hello.keyShareGroups.filter((g) => !isGrease(g)).map(groupName)).toEqual(["X25519MLKEM768", "x25519"]);
  });

  it("reads what OpenSSL sends: no GREASE, encrypt_then_mac, padding to 512 bytes", () => {
    const hello = parseClientHello(python);
    expect(hello.ciphers.some(isGrease)).toBe(false);
    expect(hello.extensions).toEqual(expect.arrayContaining(["0016", "0015"]));
    expect(hello.bytes).toBe(517);
  });

  it("maps every byte of the hello to a labelled field, in order and without gaps", () => {
    for (const raw of [chromium, node, python, schannel]) {
      const { fields } = parseClientHello(raw);
      let end = 0;
      for (const f of fields) {
        expect(f.offset).toBe(end);
        end = f.offset + f.length;
      }
      expect(end).toBe(raw.length);
    }
    const labels = parseClientHello(chromium).fields.map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["random", "ext key_share", "ext encrypted_client_hello"]));
    expect(labels.some((l) => l.startsWith("GREASE"))).toBe(true);
  });

  it("names codes, and shows the unknown ones as hex", () => {
    expect(cipherName("1301")).toBe("TLS_AES_128_GCM_SHA256");
    expect(extensionName("0a0a")).toBe("GREASE 0a0a");
    expect(extensionName("beef")).toBe("0xbeef");
  });
});

describe("reading off the wire", () => {
  it("asks for more bytes until the hello is complete", () => {
    expect(bytesMissing(chromium.subarray(0, 3))).toBe(6);
    expect(bytesMissing(chromium.subarray(0, 100))).toBeGreaterThan(0);
    expect(bytesMissing(chromium)).toBe(0);
  });

  it("assembles a hello split across two TLS records", () => {
    const body = chromium.subarray(5);
    const record = (part: Buffer) =>
      Buffer.concat([Buffer.from([0x16, 0x03, 0x01, part.length >> 8, part.length & 0xff]), part]);
    const split = Buffer.concat([record(body.subarray(0, 700)), record(body.subarray(700))]);
    expect(bytesMissing(split.subarray(0, 800))).toBeGreaterThan(0);
    expect(bytesMissing(split)).toBe(0);
    expect(ja4(parseClientHello(split)).ja4).toBe(ja4(parseClientHello(chromium)).ja4);
  });

  it("rejects what is not a ClientHello right away", () => {
    expect(() => bytesMissing(Buffer.from("GET / HTTP/1.1\r\n"))).toThrow(NotClientHello);
    expect(() => bytesMissing(Buffer.from([0x16, 3, 1, 0, 4, 0x02, 0, 0, 0]))).toThrow(NotClientHello);
    expect(() => bytesMissing(Buffer.from([0x16, 3, 1, 0, 4, 0x01, 0xff, 0xff, 0xff]))).toThrow(/too large/);
  });

  it("never throws anything but NotClientHello, however the bytes are cut or corrupted", () => {
    for (let n = 0; n <= python.length; n++) {
      try {
        parseClientHello(python.subarray(0, n));
      } catch (err) {
        expect(err).toBeInstanceOf(NotClientHello);
      }
    }
    // Lie in every length field: flip each byte of the header region and parse again.
    for (let i = 0; i < 120; i++) {
      const bad = Buffer.from(python);
      bad[i] ^= 0xff;
      try {
        parseClientHello(bad);
      } catch (err) {
        expect(err).toBeInstanceOf(NotClientHello);
      }
    }
  });
});
