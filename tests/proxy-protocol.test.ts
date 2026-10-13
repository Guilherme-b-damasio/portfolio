import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TappedConnections } from "../src/domain/tls.js";
import { proxiedClient } from "../src/http/middleware/proxied-client.js";
import { BadProxyHeader, readProxyHeader } from "../src/infrastructure/tls/proxy-protocol.js";
import { proxyV2, SIG } from "./fixtures/proxy-header.js";

describe("PROXY protocol v1", () => {
  it("reads TCP4 and TCP6 lines", () => {
    const line = Buffer.from("PROXY TCP4 200.150.1.2 10.0.0.5 51000 8443\r\n");
    expect(readProxyHeader(Buffer.concat([line, Buffer.from([0x16, 3, 1])]))).toEqual({
      complete: true,
      length: line.length,
      client: { address: "200.150.1.2", port: 51000 },
    });
    expect(readProxyHeader(Buffer.from("PROXY TCP6 2804:14c::5 ::1 443 8443\r\n"))).toMatchObject({
      client: { address: "2804:14c::5", port: 443 },
    });
  });

  it("treats UNKNOWN as the proxy talking for itself", () => {
    expect(readProxyHeader(Buffer.from("PROXY UNKNOWN\r\n"))).toEqual({ complete: true, length: 15, client: null });
  });

  it("waits for the rest of a line and rejects what can't be one", () => {
    expect(readProxyHeader(Buffer.from("PRO"))).toEqual({ complete: false });
    expect(readProxyHeader(Buffer.from("PROXY TCP4 1.2.3.4"))).toEqual({ complete: false });
    expect(() => readProxyHeader(Buffer.from("PROXY " + "9".repeat(120)))).toThrow(BadProxyHeader);
    expect(() => readProxyHeader(Buffer.from("PROXY TCP4 999.1.1.1 1.1.1.1 1 2\r\n"))).toThrow(BadProxyHeader);
    expect(() => readProxyHeader(Buffer.from("PROXY TCP6 1.2.3.4 1.1.1.1 1 2\r\n"))).toThrow(BadProxyHeader);
    expect(() => readProxyHeader(Buffer.from([0x16, 3, 1, 0, 5]))).toThrow(BadProxyHeader);
  });
});

describe("PROXY protocol v2", () => {
  it("reads IPv4 and IPv6 clients and skips trailing TLVs", () => {
    const tlv = Buffer.from([0x04, 0x00, 0x01, 0x00]); // a NOOP TLV
    const v4 = proxyV2({ address: "200.150.1.2", port: 51000 }, tlv);
    expect(readProxyHeader(v4)).toEqual({
      complete: true,
      length: v4.length,
      client: { address: "200.150.1.2", port: 51000 },
    });
    const v6 = proxyV2({ address: "2804:14c:0:0:0:0:0:5", port: 443 });
    expect(readProxyHeader(v6)).toMatchObject({ client: { address: "2804:14c::5", port: 443 } });
  });

  it("waits for the whole header", () => {
    const v4 = proxyV2({ address: "1.2.3.4", port: 1 });
    for (let n = 0; n < v4.length; n++) expect(readProxyHeader(v4.subarray(0, n)).complete).toBe(false);
  });

  it("accepts LOCAL health checks and rejects other versions and commands", () => {
    const local = Buffer.from([...SIG, 0x20, 0x00, 0, 0]);
    expect(readProxyHeader(local)).toEqual({ complete: true, length: 16, client: null });
    expect(() => readProxyHeader(Buffer.from([...SIG, 0x11, 0x11, 0, 0]))).toThrow(/version/);
    expect(() => readProxyHeader(Buffer.from([...SIG, 0x22, 0x11, 0, 0]))).toThrow(/command/);
  });
});

describe("proxiedClient", () => {
  let server: Server;
  let base: string;
  let announced: string | null = null;
  const tapped: TappedConnections = { fingerprint: () => null, clientAddress: () => announced };

  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(proxiedClient(tapped));
    app.get("/", (req, res) => {
      res.json({ ip: req.ip });
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it("uses the announced address, over any X-Forwarded-For the client wrote", async () => {
    announced = "200.150.1.2";
    const res = await fetch(base, { headers: { "x-forwarded-for": "6.6.6.6" } });
    expect((await res.json()).ip).toBe("200.150.1.2");
  });

  it("leaves req.ip alone when nothing was announced", async () => {
    announced = null;
    expect((await (await fetch(base)).json()).ip).toMatch(/127\.0\.0\.1$/); // "::ffff:" on a dual-stack socket
  });
});
