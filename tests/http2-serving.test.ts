import express from "express";
import http2 from "node:http2";
import https from "node:https";
import type { AddressInfo, Server } from "node:net";
import tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AlpnServer } from "../src/infrastructure/http2/alpn-server.js";
import { duplexPair } from "../src/infrastructure/http2/duplex-pair.js";
import { Http1Bridge } from "../src/infrastructure/http2/http1-bridge.js";
import { TrackedHttp2Connections } from "../src/infrastructure/http2/tracked-http2-connections.js";
import { TlsTap } from "../src/infrastructure/tls/tls-tap.js";
import { selfSigned } from "./fixtures/self-signed.js";

const creds = selfSigned();

describe("duplexPair", () => {
  it("carries bytes both ways and ends the other side", async () => {
    const [a, b] = duplexPair();
    const got: string[] = [];
    b.on("data", (d) => got.push(String(d)));
    const ended = new Promise((r) => b.on("end", r));
    a.write("ping");
    a.end();
    await ended;
    expect(got.join("")).toBe("ping");
  });

  it("destroys the other side", () => {
    const [a, b] = duplexPair();
    a.destroy();
    expect(b.destroyed).toBe(true);
  });
});

describe.skipIf(!creds)("h2 and HTTP/1.1 on the same TLS port, behind the tap", () => {
  const tap = new TlsTap({ helloTimeoutMs: 1_000 });
  const connections = new TrackedHttp2Connections();
  let tcp: Server;
  let origin: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    // Each request answers with what the app could see of it.
    app.get("/seen", (req, res) => {
      const { remoteAddress, remotePort } = req.socket;
      res.set("x-custom", "yes").json({
        ip: req.ip,
        secure: req.secure,
        host: req.headers.host,
        order: req.rawHeaders.filter((_, i) => i % 2 === 0).map((h) => h.toLowerCase()),
        ja4: tap.fingerprint(remoteAddress!, remotePort!)?.ja4 ?? null,
        h2: connections.http2(remoteAddress!, remotePort!)?.akamai ?? null,
      });
    });
    app.post("/echo", (req, res) => res.status(201).json(req.body));
    app.get("/stream", (_req, res) => {
      res.set("content-type", "text/event-stream");
      res.write("data: 1\n\n");
      setTimeout(() => res.end("data: 2\n\n"), 20);
    });
    const front = new AlpnServer(new Http1Bridge(app), creds!, connections, { prefaceTimeoutMs: 300 });
    tcp = tap.server(front.server).listen(0, "127.0.0.1");
    await new Promise((r) => tcp.once("listening", r));
    origin = `https://127.0.0.1:${(tcp.address() as AddressInfo).port}`;
  });
  afterAll(() => tcp.close());

  const h2 = (headers: http2.OutgoingHttpHeaders, body?: string) =>
    new Promise<{ status: number; headers: http2.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const session = http2.connect(origin, { rejectUnauthorized: false, servername: "localhost" });
      session.on("error", reject);
      const req = session.request(headers);
      let text = "";
      let head: http2.IncomingHttpHeaders = {};
      req.on("response", (h) => (head = h));
      req.on("data", (d) => (text += d));
      req.on("end", () => {
        session.close();
        resolve({ status: Number(head[":status"]), headers: head, body: text });
      });
      req.on("error", reject);
      req.end(body);
    });

  it("serves the app over h2 with the visitor's address, TLS and the h2 fingerprint", async () => {
    const res = await h2({ ":path": "/seen", ":method": "GET", "user-agent": "probe/1", accept: "*/*" });
    expect(res.status).toBe(200);
    expect(res.headers["x-custom"]).toBe("yes");
    const seen = JSON.parse(res.body);
    expect(seen.ip).toMatch(/127\.0\.0\.1$/);
    expect(seen.secure).toBe(true);
    expect(seen.host).toBe(`localhost:${new URL(origin).port}`); // :authority, from the servername
    expect(seen.ja4).toMatch(/^t13d\d{4}h2_/);
    expect(seen.h2).toMatch(/\|p,m,a,s$/);
    // The client's own header order survives the hop, Host standing where :authority was.
    expect(seen.order.slice(0, 3)).toEqual(["host", "user-agent", "accept"]);
  });

  it("carries request bodies and status codes across the bridge", async () => {
    const res = await h2(
      { ":path": "/echo", ":method": "POST", "content-type": "application/json" },
      JSON.stringify({ q: "oi" }),
    );
    expect(res.status).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ q: "oi" });
  });

  it("streams server-sent events as they are written", async () => {
    const res = await h2({ ":path": "/stream" });
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.headers["transfer-encoding"]).toBeUndefined();
    expect(res.body).toBe("data: 1\n\ndata: 2\n\n");
  });

  it("still serves HTTP/1.1 clients, with no h2 fingerprint", async () => {
    const seen = await new Promise<{ h2: string | null; secure: boolean; ja4: string }>((resolve, reject) => {
      https
        .get(
          `${origin}/seen`,
          { rejectUnauthorized: false, agent: false, ALPNProtocols: ["http/1.1"] } as https.RequestOptions,
          (res) => {
            let body = "";
            res.on("data", (d) => (body += d));
            res.on("end", () => resolve(JSON.parse(body)));
          },
        )
        .on("error", reject);
    });
    expect(seen.h2).toBeNull();
    expect(seen.secure).toBe(true);
    expect(seen.ja4).toMatch(/h1_/);
  });

  it("drops a client that negotiates h2 and never sends the preface, and forgets closed connections", async () => {
    const closedAfter = await new Promise<number>((resolve) => {
      const started = Date.now();
      const s = tls.connect({
        port: Number(new URL(origin).port),
        host: "127.0.0.1",
        rejectUnauthorized: false,
        ALPNProtocols: ["h2"],
      });
      s.on("close", () => resolve(Date.now() - started));
      s.on("error", () => {});
    });
    expect(closedAfter).toBeGreaterThanOrEqual(250);
    await new Promise((r) => setTimeout(r, 50));
    expect(connections.tracked).toBe(0);
  });

  it("lets the HTTP/2 server turn away bytes that aren't a preface", async () => {
    const reply = await new Promise<string>((resolve) => {
      const s = tls.connect(
        { port: Number(new URL(origin).port), host: "127.0.0.1", rejectUnauthorized: false, ALPNProtocols: ["h2"] },
        () => s.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"),
      );
      let got = "";
      s.on("data", (d) => (got += d.toString("latin1")));
      s.on("close", () => resolve(got));
      s.on("error", () => resolve(got));
    });
    expect(reply).not.toContain("HTTP/1.1 200");
  });
});
