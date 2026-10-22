import { describe, expect, it } from "vitest";
import {
  ATTR,
  attr,
  BadMessage,
  CLASS,
  crc32,
  findAttribute,
  formatAddress,
  HEADER_BYTES,
  METHOD,
  addressBytes,
  messageType,
  parseMessage,
  readXorMappedAddress,
  writeMessage,
} from "../src/infrastructure/stun/message.js";

// The transaction id RFC 5769 uses in its test vectors, so the masked addresses below are its.
const TRANSACTION = Buffer.from("b7e7a701bc34d686fa87dfae", "hex");

function bindingRequest(attributes: Buffer = Buffer.alloc(0), transactionId: Buffer = TRANSACTION): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt16BE(0x0001, 0);
  header.writeUInt16BE(attributes.length, 2);
  header.writeUInt32BE(0x2112a442, 4);
  transactionId.copy(header, 8);
  return Buffer.concat([header, attributes]);
}

function attribute(type: number, value: Buffer): Buffer {
  const padded = Buffer.alloc(4 + value.length + ((4 - (value.length % 4)) % 4));
  padded.writeUInt16BE(type, 0);
  padded.writeUInt16BE(value.length, 2);
  value.copy(padded, 4);
  return padded;
}

describe("stun message", () => {
  it("reads a binding request, its class and its attributes", () => {
    const message = parseMessage(bindingRequest(attribute(ATTR.SOFTWARE, Buffer.from("navegador"))));
    expect(message.method).toBe(METHOD.BINDING);
    expect(message.class).toBe(CLASS.REQUEST);
    expect(message.transactionId.toString("hex")).toBe(TRANSACTION.toString("hex"));
    expect(findAttribute(message, ATTR.SOFTWARE)?.toString()).toBe("navegador");
    expect(message.unknownRequired).toEqual([]);
  });

  it("splits the method around the class bits, both ways", () => {
    for (const cls of [CLASS.REQUEST, CLASS.INDICATION, CLASS.SUCCESS, CLASS.ERROR]) {
      const type = messageType(METHOD.BINDING, cls);
      const message = parseMessage(writeMessage({ class: cls, transactionId: TRANSACTION, attributes: [] }));
      expect(message.class).toBe(cls);
      expect(message.method).toBe(METHOD.BINDING);
      expect(type & 0xc000).toBe(0);
    }
  });

  it("lists the comprehension-required attributes it does not know, and ignores the optional ones", () => {
    const ice = attribute(ATTR.PRIORITY, Buffer.alloc(4)); // an ICE check aimed at us: understood enough
    const mine = attribute(0x0ff0, Buffer.alloc(4));
    const theirs = attribute(0x8ff0, Buffer.alloc(4));
    const message = parseMessage(bindingRequest(Buffer.concat([ice, mine, theirs])));
    expect(message.unknownRequired).toEqual([0x0ff0]);
  });

  it("refuses what is not a STUN message", () => {
    expect(() => parseMessage(Buffer.alloc(8))).toThrow(BadMessage);
    const noCookie = bindingRequest();
    noCookie.writeUInt32BE(0xdeadbeef, 4);
    expect(() => parseMessage(noCookie)).toThrow(/magic cookie/);
    const leading = bindingRequest();
    leading[0] = 0xc0;
    expect(() => parseMessage(leading)).toThrow(/significant bits/);
    const long = bindingRequest();
    long.writeUInt16BE(40, 2);
    expect(() => parseMessage(long)).toThrow(/end early/);
    const unaligned = bindingRequest();
    unaligned.writeUInt16BE(3, 2);
    expect(() => parseMessage(unaligned)).toThrow(/multiple of four/);
  });

  it("masks an IPv4 address the way RFC 5769 does", () => {
    const value = attr.xorMappedAddress({ address: "192.0.2.1", port: 32853 }, TRANSACTION).value;
    expect(value.toString("hex")).toBe("0001a147e112a643");
    expect(readXorMappedAddress(value, TRANSACTION)).toEqual({ address: "192.0.2.1", port: 32853 });
  });

  it("masks an IPv6 address with the transaction id too", () => {
    const address = "2001:db8:1234:5678:11:2233:4455:6677";
    const value = attr.xorMappedAddress({ address, port: 32853 }, TRANSACTION).value;
    expect(value.toString("hex")).toBe("0002a14701" + "13a9faa5d3f179bc25f4b5bed2b9d9");
    expect(readXorMappedAddress(value, TRANSACTION)).toEqual({ address, port: 32853 });
  });

  it("writes a response with a fingerprint the client can check", () => {
    const response = writeMessage({
      class: CLASS.SUCCESS,
      transactionId: TRANSACTION,
      attributes: [attr.xorMappedAddress({ address: "198.51.100.7", port: 54321 }, TRANSACTION)],
    });
    const message = parseMessage(response);
    expect(message.class).toBe(CLASS.SUCCESS);
    const fingerprint = findAttribute(message, ATTR.FINGERPRINT)!;
    // The fingerprint covers everything before it, with the length already counting the attribute.
    expect(fingerprint.readUInt32BE(0)).toBe((crc32(response.subarray(0, response.length - 8)) ^ 0x5354554e) >>> 0);
    expect(readXorMappedAddress(findAttribute(message, ATTR.XOR_MAPPED_ADDRESS)!, TRANSACTION)).toEqual({
      address: "198.51.100.7",
      port: 54321,
    });
  });

  it("writes an error with its class and reason", () => {
    const response = writeMessage({
      class: CLASS.ERROR,
      transactionId: TRANSACTION,
      attributes: [attr.errorCode(420, "Unknown Attribute"), attr.unknownAttributes([0x0ff0])],
    });
    const message = parseMessage(response);
    const error = findAttribute(message, ATTR.ERROR_CODE)!;
    expect([error[2], error[3]]).toEqual([4, 20]);
    expect(error.subarray(4).toString()).toBe("Unknown Attribute");
    expect(findAttribute(message, ATTR.UNKNOWN_ATTRIBUTES)!.readUInt16BE(0)).toBe(0x0ff0);
  });

  it("reads and writes addresses of both families", () => {
    expect(addressBytes("::ffff:203.0.113.9")).toEqual([203, 0, 113, 9]);
    expect(addressBytes("fe80::1%eth0")?.length).toBe(16);
    expect(addressBytes("2001:db8::")?.slice(0, 4)).toEqual([0x20, 0x01, 0x0d, 0xb8]);
    expect(addressBytes("::")).toEqual(new Array(16).fill(0));
    expect(addressBytes("1.2.3.999")).toBeNull();
    expect(addressBytes("2001:db8:1:2:3:4:5:6:7")).toBeNull();
    expect(addressBytes("nope")).toBeNull();
    expect(formatAddress(Buffer.from("20010db8000000000000000000000001", "hex"))).toBe("2001:db8::1");
    expect(formatAddress(Buffer.from([203, 0, 113, 9]))).toBe("203.0.113.9");
  });

  it("computes the usual CRC-32 check value", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
