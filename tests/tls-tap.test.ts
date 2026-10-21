import https from "node:https";
import net from "node:net";
import type { AddressInfo } from "node:net";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TlsTap } from "../src/infrastructure/tls/tls-tap.js";
import { proxyV2 } from "./fixtures/proxy-header.js";
import { selfSigned } from "./fixtures/self-signed.js";

const creds = selfSigned();

describe.skipIf(!creds)("TlsTap in front of a real HTTPS server", () => {
  const tap = new TlsTap({ helloTimeoutMs: 300 });
  let tcp: net.Server;
  let port: number;

  beforeAll(async () => {
    // The handler answers with the fingerprint of the very socket the request came in on.
    const httpsServer = https.createServer(creds!, (req, res) => {
      const fp = tap.fingerprint(req.socket.remoteAddress!, req.socket.remotePort!);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ja4: fp?.ja4 ?? null, sni: fp?.hello.sni ?? null, tracked: tap.tracked }));
    });
    tcp = tap.server(httpsServer);
    tcp.listen(0, "127.0.0.1");
    await new Promise((resolve) => tcp.once("listening", resolve));
    port = (tcp.address() as AddressInfo).port;
  });
  afterAll(() => tcp.close());

  const get = (servername: string, alpn?: string[]) =>
    new Promise<{ ja4: string | null; sni: string | null; tracked: number }>((resolve, reject) => {
      const req = https.get(
        {
          host: "127.0.0.1",
          port,
          path: "/",
          servername,
          rejectUnauthorized: false,
          agent: false,
          ALPNProtocols: alpn,
        } as https.RequestOptions,
        (res) => {
          let body = "";
          res.on("data", (d) => (body += d));
          res.on("end", () => resolve(JSON.parse(body)));
        },
      );
      req.on("error", reject);
    });

  it("completes the handshake and knows the client's JA4 inside the request", async () => {
    const seen = await get("portfolio.test");
    expect(seen.ja4).toMatch(/^t13d\d{4}00_[0-9a-f]{12}_[0-9a-f]{12}$/); // no ALPN offered: "00"
    expect(seen.sni).toBe("portfolio.test");
    expect(seen.tracked).toBeGreaterThanOrEqual(1);
  });

  it("sees a different fingerprint when the client changes its offer", async () => {
    const h1 = await get("portfolio.test");
    const h2 = await get("portfolio.test", ["h2", "http/1.1"]);
    expect(h2.ja4?.slice(0, 10)).not.toBe(h1.ja4?.slice(0, 10)); // ALPN chars and extension count move
  });

  it("forgets a fingerprint once its socket closes", async () => {
    await get("portfolio.test");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tap.tracked).toBe(0);
  });

  it("hands plain HTTP to the TLS server, which turns it away", async () => {
    const reply = await new Promise<string>((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => s.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
      let got = "";
      s.on("data", (d) => (got += d.toString("latin1")));
      s.on("close", () => resolve(got));
      s.on("error", () => resolve(got));
    });
    expect(reply).not.toContain("ja4");
  });

  it("drops a client that connects and never says hello", async () => {
    const closedAfter = await new Promise<number>((resolve) => {
      const started = Date.now();
      const s = net.connect(port, "127.0.0.1");
      s.on("close", () => resolve(Date.now() - started));
      s.on("error", () => {});
    });
    expect(closedAfter).toBeGreaterThanOrEqual(250);
    expect(closedAfter).toBeLessThan(2000);
  });
});

const CRLF = String.fromCharCode(13, 10);

describe.skipIf(!creds)("TlsTap behind a TCP proxy (PROXY protocol)", () => {
  const tap = new TlsTap({ proxyProtocol: true, helloTimeoutMs: 300 });
  let tcp: net.Server;
  let port: number;

  beforeAll(async () => {
    const httpsServer = https.createServer(creds!, (req, res) => {
      const { remoteAddress, remotePort } = req.socket;
      res.end(
        JSON.stringify({
          client: tap.clientAddress(remoteAddress!, remotePort!),
          ja4: tap.fingerprint(remoteAddress!, remotePort!)?.ja4 ?? null,
        }),
      );
    });
    tcp = tap.server(httpsServer);
    tcp.listen(0, "127.0.0.1");
    await new Promise((resolve) => tcp.once("listening", resolve));
    port = (tcp.address() as AddressInfo).port;
  });
  afterAll(() => tcp.close());

  /** Plays the proxy: writes the PROXY header, then runs a real TLS session and a request over the same socket. */
  const viaProxy = (header: Buffer | null) =>
    new Promise<{ client: string | null; ja4: string | null } | "closed">((resolve) => {
      const raw = net.connect(port, "127.0.0.1", () => {
        if (header) raw.write(header);
        const secure = tls.connect({ socket: raw, servername: "portfolio.test", rejectUnauthorized: false }, () => {
          secure.write("GET / HTTP/1.1" + CRLF + "Host: portfolio.test" + CRLF + "Connection: close" + CRLF + CRLF);
        });
        let reply = "";
        secure.on("data", (d) => (reply += d));
        secure.on("error", () => resolve("closed"));
        secure.on("close", () => {
          const body = reply.split(CRLF + CRLF)[1];
          resolve(body ? JSON.parse(body) : "closed");
        });
      });
      raw.on("error", () => resolve("closed"));
    });

  it("strips the header, completes the handshake and knows the visitor's address", async () => {
    const seen = await viaProxy(proxyV2({ address: "200.150.1.2", port: 51000 }));
    expect(seen).toMatchObject({ client: "200.150.1.2", ja4: expect.stringMatching(/^t13d/) });
  });

  it("also takes the text form of the header", async () => {
    const seen = await viaProxy(Buffer.from("PROXY TCP6 2804:14c::5 ::1 51000 443\r\n"));
    expect(seen).toMatchObject({ client: "2804:14c::5" });
  });

  it("refuses a connection that skips the header", async () => {
    expect(await viaProxy(null)).toBe("closed");
  });
});
