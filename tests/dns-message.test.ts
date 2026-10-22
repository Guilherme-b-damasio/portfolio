import { describe, expect, it } from "vitest";
import {
  BadMessage,
  formatError,
  formatIpv6,
  ipv6Bytes,
  parseQuery,
  RCODE,
  rdata,
  TYPE,
  typeName,
  writeAnswer,
} from "../src/infrastructure/dns/message.js";
import { dnsQuery } from "./fixtures/dns-query.js";

describe("DNS queries", () => {
  it("reads the question as sent, case included, and the EDNS UDP size", () => {
    const query = parseQuery(dnsQuery("AbC.Leak.Example.com", TYPE.AAAA, { id: 0xbeef }));
    expect(query).toEqual({
      id: 0xbeef,
      opcode: 0,
      recursionDesired: false,
      question: { labels: ["AbC", "Leak", "Example", "com"], type: TYPE.AAAA, class: 1 },
      edns: { udpSize: 1232, clientSubnet: null },
    });
    expect(parseQuery(dnsQuery("a.b", TYPE.A, { edns: false })).edns).toBeNull();
  });

  it("reads the client subnet a resolver forwards, IPv4 and IPv6", () => {
    const v4 = parseQuery(dnsQuery("x.y", TYPE.A, { subnet: { family: 1, prefix: 24, bytes: [200, 150, 1] } }));
    expect(v4.edns?.clientSubnet).toEqual({ family: 4, address: "200.150.1.0", prefix: 24 });
    const v6 = parseQuery(
      dnsQuery("x.y", TYPE.A, { subnet: { family: 2, prefix: 56, bytes: [0x28, 0x04, 0x01, 0x4c, 0, 0x12, 0x34] } }),
    );
    expect(v6.edns?.clientSubnet).toEqual({ family: 6, address: "2804:14c:12:3400::", prefix: 56 });
    // A prefix that does not match the bytes sent is ignored, not trusted.
    const bad = parseQuery(dnsQuery("x.y", TYPE.A, { subnet: { family: 1, prefix: 24, bytes: [200] } }));
    expect(bad.edns?.clientSubnet).toBeNull();
  });

  it("follows compression pointers backwards and refuses loops and overruns", () => {
    // Question name "a" + pointer to a name placed earlier is not possible in a query, so build an
    // additional record whose owner points at the question name.
    const base = dnsQuery("p.q", TYPE.A, { edns: false });
    const header = Buffer.from(base);
    header.writeUInt16BE(1, 10);
    const rr = Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(parseQuery(Buffer.concat([header, rr])).question.labels).toEqual(["p", "q"]);

    const loop = Buffer.from(base);
    loop.writeUInt16BE(0xc00c, 12); // the question name points at itself
    expect(() => parseQuery(loop)).toThrow(BadMessage);
    expect(() => parseQuery(base.subarray(0, base.length - 3))).toThrow(BadMessage);
    expect(() => parseQuery(Buffer.alloc(5))).toThrow(BadMessage);
  });

  it("refuses responses and anything but a single question", () => {
    const response = dnsQuery("a.b", TYPE.A);
    response.writeUInt16BE(0x8000, 2);
    expect(() => parseQuery(response)).toThrow(/response/);
    const two = dnsQuery("a.b", TYPE.A);
    two.writeUInt16BE(2, 4);
    expect(() => parseQuery(two)).toThrow(BadMessage);
  });

  it("names the record types, and the unknown ones the RFC 3597 way", () => {
    expect([typeName(1), typeName(28), typeName(65)]).toEqual(["A", "AAAA", "TYPE65"]);
  });
});

describe("DNS answers", () => {
  it("echoes the id and question, sets AA and writes the records", () => {
    const query = parseQuery(dnsQuery("AbC.zone", TYPE.A, { id: 7 }));
    const answer = writeAnswer(query, {
      rcode: RCODE.NOERROR,
      authoritative: true,
      answers: [{ labels: query.question.labels, type: TYPE.A, ttl: 60, data: rdata.a("203.0.113.9") }],
    });
    expect(answer.readUInt16BE(0)).toBe(7);
    expect(answer.readUInt16BE(2)).toBe(0x8400);
    expect([answer.readUInt16BE(4), answer.readUInt16BE(6), answer.readUInt16BE(8), answer.readUInt16BE(10)]).toEqual([
      1, 1, 0, 1,
    ]);
    expect(answer.includes(Buffer.from("AbC"))).toBe(true);
    expect(answer.includes(Buffer.from([203, 0, 113, 9]))).toBe(true);
  });

  it("echoes the client subnet with scope 0, so resolvers cache one answer for everyone", () => {
    const query = parseQuery(dnsQuery("x.y", TYPE.A, { subnet: { family: 1, prefix: 24, bytes: [200, 150, 1] } }));
    const answer = writeAnswer(query, { rcode: RCODE.NXDOMAIN, authoritative: true });
    expect(answer.subarray(-11)).toEqual(Buffer.from([0, 8, 0, 7, 0, 1, 24, 0, 200, 150, 1]));
    expect(answer.readUInt16BE(2) & 0xf).toBe(RCODE.NXDOMAIN);
  });

  it("answers an unreadable query with FORMERR, and a non-query with nothing", () => {
    const garbage = Buffer.from([0xab, 0xcd, 0x01, 0, 0, 9, 0, 0, 0, 0, 0, 0, 3]);
    expect(formatError(garbage)).toEqual(Buffer.from([0xab, 0xcd, 0x80, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(formatError(Buffer.alloc(4))).toBeNull();
    const response = Buffer.alloc(12);
    response[2] = 0x80;
    expect(formatError(response)).toBeNull();
  });

  it("writes and prints IPv6 addresses the RFC 5952 way", () => {
    expect(formatIpv6(ipv6Bytes("2001:db8::1"))).toBe("2001:db8::1");
    expect(formatIpv6(ipv6Bytes("2001:db8:0:1:0:0:0:1"))).toBe("2001:db8:0:1::1");
    expect(formatIpv6(Buffer.alloc(16))).toBe("::");
    expect(formatIpv6(ipv6Bytes("1:2:3:4:5:6:7:8"))).toBe("1:2:3:4:5:6:7:8");
    expect(() => ipv6Bytes("1::2::3")).toThrow(BadMessage);
  });
});
