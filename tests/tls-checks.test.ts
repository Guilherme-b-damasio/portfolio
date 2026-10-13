import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BrowseTlsSamples } from "../src/application/browse-tls-samples.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { TlsStackCheck, TlsStrengthCheck } from "../src/application/scan/checks/tls.js";
import { classifyStack } from "../src/application/scan/tls-stack.js";
import { parseUserAgent } from "../src/application/scan/user-agent.js";
import type { ExposureCheck, ScanContext } from "../src/domain/exposure.js";
import type { TlsFingerprint } from "../src/domain/tls.js";
import { parseClientHello } from "../src/infrastructure/tls/client-hello.js";
import { FileTlsSamples } from "../src/infrastructure/tls/file-tls-samples.js";
import { ja4 } from "../src/infrastructure/tls/ja4.js";
import { UA } from "./fixtures/user-agents.js";

const hello = (name: string): TlsFingerprint =>
  ja4(
    parseClientHello(
      Buffer.from(
        readFileSync(path.join(import.meta.dirname, "..", "data", "tls-samples", `${name}.hex`), "utf8"),
        "hex",
      ),
    ),
  );
const chromium = hello("chromium-152");
const python = hello("python-urllib");
const node = hello("node-openssl");
const schannel = hello("curl-schannel");

function ctx(ua: string, tls: TlsFingerprint | null): ScanContext {
  return {
    observation: {
      ip: "200.150.1.2",
      headers: { "user-agent": ua },
      httpVersion: "1.1",
      viaProxy: false,
      tls,
      headerOrder: ["host", "user-agent", "accept"],
    },
    probe: null,
    claimed: parseUserAgent(ua),
    reverseDns: null,
    now: new Date(Date.UTC(2026, 9, 13)),
  };
}
const ids = (check: ExposureCheck, c: ScanContext) => check.run(c).map((f) => `${f.verdict}:${f.id}`);

describe("TLS stack", () => {
  it("tells the libraries apart from their real handshakes", () => {
    expect(classifyStack(chromium.hello).family).toBe("boringssl");
    expect(classifyStack(python.hello).family).toBe("openssl");
    expect(classifyStack(node.hello).family).toBe("openssl");
    expect(classifyStack(schannel.hello).family).toBe("schannel");
  });

  it("confirms a real Chrome", () => {
    expect(ids(new TlsStackCheck(), ctx(UA.chromeWin, chromium))).toEqual(["ok:tls-stack"]);
  });

  it("unmasks a script wearing a Chrome User-Agent", () => {
    const [finding] = new TlsStackCheck().run(ctx(UA.chromeWin, python));
    expect(finding.verdict).toBe("contradicao");
    expect(finding.title).toContain("OpenSSL");
    expect(finding.evidence[0]).toBe(`JA4: ${python.ja4}`);
  });

  it("expects Apple's stack from every browser on iOS, and from Firefox its own", () => {
    const chromeOnIos = UA.safariIphone.replace("Version/18.0", "CriOS/153.0.0.0");
    expect(ids(new TlsStackCheck(), ctx(chromeOnIos, chromium))).toEqual(["contradicao:tls-stack"]);
    expect(ids(new TlsStackCheck(), ctx(UA.firefoxLinux, chromium))).toEqual(["contradicao:tls-stack"]);
  });

  it("only describes the stack of an honest tool, and stays quiet without a handshake", () => {
    expect(ids(new TlsStackCheck(), ctx(UA.curl, schannel))).toEqual(["info:tls-stack"]);
    expect(new TlsStackCheck().run(ctx(UA.chromeWin, null))).toEqual([]);
  });
});

describe("TLS strength", () => {
  it("credits post-quantum key exchange and ECH", () => {
    expect(ids(new TlsStrengthCheck(), ctx(UA.chromeWin, chromium))).toEqual([
      "ok:tls-strength-pq",
      "ok:tls-strength-ech",
    ]);
  });

  it("notes what an older OpenSSL leaves out", () => {
    const found = ids(new TlsStrengthCheck(), ctx(UA.python, python));
    expect(found).toContain("info:tls-strength-pq"); // OpenSSL 3.0 has no ML-KEM
    expect(found).toContain("info:tls-strength-sni");
  });
});

describe("the report", () => {
  it("carries the annotated hello and the TLS layer signals", async () => {
    const report = await new InspectVisitor([new TlsStackCheck()], { lookup: async () => null }).execute(
      ctx(UA.chromeWin, chromium).observation,
      null,
    );
    expect(report.tls).toMatchObject({ ja4: chromium.ja4, bytes: chromium.hello.bytes });
    expect(report.tls?.fields.length).toBeGreaterThan(10);
    const tlsLabels = report.signals.filter((s) => s.layer === "tls").map((s) => s.label);
    expect(tlsLabels).toEqual(expect.arrayContaining(["JA4", "pilha provável", "key_share"]));
    expect(report.signals).toContainEqual({
      layer: "http",
      label: "ordem dos cabeçalhos",
      value: "host → user-agent → accept",
    });
    expect(report.signals).toContainEqual({
      layer: "rede",
      label: "caminho",
      value: "você → este processo, TLS de ponta a ponta",
    });
  });
});

describe("the sample gallery", () => {
  it("loads every captured handshake with its stack and annotated bytes", async () => {
    const source = await FileTlsSamples.load(path.join(import.meta.dirname, "..", "data", "tls-samples"));
    const views = new BrowseTlsSamples(source).list();
    expect(views.map((v) => v.id)).toEqual(["chromium-152", "python-urllib", "node-openssl", "curl-schannel"]);
    expect(views[0]).toMatchObject({
      label: "Chromium 152",
      ja4: chromium.ja4,
      stack: expect.stringContaining("BoringSSL"),
    });
    expect(views[1].stack).toContain("OpenSSL");
    expect(views[3].stack).toContain("Schannel");
    for (const v of views) expect(v.hex.length).toBe(v.bytes * 2);
  });
});
