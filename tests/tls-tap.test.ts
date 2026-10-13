import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import net from "node:net";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TlsTap } from "../src/infrastructure/tls/tls-tap.js";

// A throwaway self-signed certificate, made with the openssl CLI. CI and Git for Windows both ship it.
function selfSigned(): { key: Buffer; cert: Buffer } | null {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tap-"));
  const file = (name: string) => path.join(dir, name);
  try {
    // Our own minimal config, so a stray OPENSSL_CONF on the machine can't break the test.
    writeFileSync(file("req.cnf"), ["[req]", "distinguished_name = dn", "[dn]", ""].join("\n"));
    const args = [
      "req",
      "-x509",
      "-config",
      file("req.cnf"),
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
    ];
    args.push("-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", file("k.pem"), "-out", file("c.pem"));
    execFileSync("openssl", args, { stdio: "ignore" });
    return { key: readFileSync(file("k.pem")), cert: readFileSync(file("c.pem")) };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const creds = selfSigned();

describe.skipIf(!creds)("TlsTap in front of a real HTTPS server", () => {
  const tap = new TlsTap(300);
  let tcp: net.Server;
  let port: number;

  beforeAll(async () => {
    // The handler answers with the fingerprint of the very socket the request came in on.
    const httpsServer = https.createServer(creds!, (req, res) => {
      const fp = tap.lookup(req.socket.remoteAddress!, req.socket.remotePort!);
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
