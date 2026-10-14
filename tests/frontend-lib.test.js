// Plain JS so it can import public/js/lib.js as the browser does, without type declarations.
import { describe, expect, it } from "vitest";
import {
  ago,
  candidateAddress,
  citationParts,
  commandForSource,
  edgesFor,
  fieldOfByte,
  formatUptime,
  guessCommand,
  highlightParts,
  hourStrip,
  ja4Parts,
  parseLine,
  parseSse,
  routeLabel,
  scanHeadline,
  sections,
  sparkPoints,
} from "../public/js/lib.js";

describe("front-end helpers", () => {
  it("formats uptime and relative build time", () => {
    expect(formatUptime(75)).toBe("1m 15s");
    expect(formatUptime(3 * 86400 + 4 * 3600)).toBe("3d 4h");
    const now = Date.parse("2026-10-13T14:00:00Z");
    expect(ago("2026-10-13T12:00:00Z", now)).toBe("há 2h");
    expect(ago(null, now)).toBe("");
  });

  it("groups project routes like the server metrics", () => {
    expect(routeLabel("GET", "/api/projects/docsage")).toBe("GET /api/projects/:slug");
    expect(routeLabel("GET", "/api/projects?tag=ia")).toBe("GET /api/projects");
  });

  it("lights the claude edge only when an answer was generated", () => {
    expect(edgesFor({ route: "POST /api/ask", status: 200, generated: true })).toContain("bc");
    expect(edgesFor({ route: "POST /api/ask", status: 200, generated: false })).not.toContain("bc");
    expect(edgesFor({ route: "POST /api/ask", status: 429 })).toEqual(["vi", "ia", "ar"]);
    expect(edgesFor({ route: "POST /api/ask", status: 503 })).toEqual(["vi", "ia", "ar"]);
    expect(edgesFor({ route: "GET /api/status", status: 200 })).toEqual(["vi", "ia", "ax"]);
    expect(edgesFor({ route: "GET /api/projects/:slug", status: 404 })).toEqual(["vi", "ia"]);
  });

  it("draws a sparkline only with two or more points", () => {
    expect(sparkPoints([1])).toBeNull();
    const { line, area } = sparkPoints([0, 10]);
    expect(line).toBe("0.0,28.0 100.0,2.0");
    expect(area).toBe("0,30 0.0,28.0 100.0,2.0 100,30");
  });

  it("marks only the hours that have a sample", () => {
    const now = 100 * 3_600_000;
    const hours = hourStrip([{ t: now - 10 }, { t: now - 3 * 3_600_000 - 5 }], now);
    expect(hours).toHaveLength(24);
    expect(hours[23]).toBe(true);
    expect(hours[20]).toBe(true);
    expect(hours.filter(Boolean)).toHaveLength(2);
  });

  it("splits a body on its headings", () => {
    expect(sections("intro\n## O que é\ntexto\n\n## Infra\nTODO")).toEqual([
      ["O que é", "texto"],
      ["Infra", "TODO"],
    ]);
  });

  it("parses quoted arguments and guesses typos", () => {
    expect(parseLine('cat docsage "Decisões técnicas"')).toEqual(["cat", "docsage", "Decisões técnicas"]);
    expect(guessCommand("stauts", ["help", "status", "clear"])).toBe("status");
    expect(guessCommand("xyz", ["help", "status"])).toBeUndefined();
  });

  it("highlights matched terms ignoring accents", () => {
    expect(highlightParts("Decisões técnicas", ["decisoes"])).toEqual([
      { text: "Decisões", mark: true },
      { text: " técnicas", mark: false },
    ]);
  });

  it("turns citations into commands", () => {
    expect(citationParts("Indexa PDF [docsage.md › O que é].")).toEqual([
      { text: "Indexa PDF " },
      { text: "[docsage.md › O que é]", source: "docsage.md › O que é" },
      { text: "." },
    ]);
    expect(commandForSource("docsage.md › Decisões técnicas")).toBe('cat docsage "Decisões técnicas"');
    expect(commandForSource("docsage.md")).toBe("cat docsage");
    expect(commandForSource("profile.md › Stack")).toBe("whoami");
  });
});

describe("front-end helpers for the v2 pages", () => {
  it("routes hashes to pages and keeps plain anchors on the home page", async () => {
    const { parseRoute } = await import("../public/js/lib.js");
    expect(parseRoute("#/projetos/docsage")).toEqual({ page: "projetos", param: "docsage", anchor: null });
    expect(parseRoute("#/sobre")).toEqual({ page: "sobre", param: null, anchor: null });
    expect(parseRoute("#ao-vivo")).toEqual({ page: "inicio", param: null, anchor: "ao-vivo" });
    expect(parseRoute("#/nada")).toEqual({ page: "inicio", param: null, anchor: null });
    expect(parseRoute("")).toEqual({ page: "inicio", param: null, anchor: null });
  });

  it("turns the content's Markdown into blocks", async () => {
    const { markdownBlocks } = await import("../public/js/lib.js");
    const md = "### Cargo · Empresa\n\n- Fiz **isso**.\n- E aquilo.\n\nUm parágrafo\nem duas linhas.\n\nTODO: escrever";
    expect(markdownBlocks(md)).toEqual([
      { type: "h3", text: "Cargo · Empresa" },
      {
        type: "li",
        parts: [
          { text: "Fiz ", bold: false },
          { text: "isso", bold: true },
          { text: ".", bold: false },
        ],
      },
      { type: "li", parts: [{ text: "E aquilo.", bold: false }] },
      { type: "p", parts: [{ text: "Um parágrafo em duas linhas.", bold: false }] },
      { type: "todo", text: "TODO: escrever" },
    ]);
  });

  it("validates the contact form like the server", async () => {
    const { validateContact } = await import("../public/js/lib.js");
    expect(validateContact({ name: "Ana", email: "ana@x.com", message: "x".repeat(20) })).toEqual({});
    expect(Object.keys(validateContact({ name: "", email: "nope", message: "curta" })).sort()).toEqual([
      "email",
      "message",
      "name",
    ]);
  });

  it("builds the install snippet per client", async () => {
    const { installSnippet } = await import("../public/js/lib.js");
    expect(installSnippet("code", "https://x/mcp")).toBe("claude mcp add --transport http portfolio https://x/mcp");
    expect(JSON.parse(installSnippet("desktop", "https://x/mcp")).mcpServers.portfolio.args).toEqual([
      "mcp-remote",
      "https://x/mcp",
    ]);
  });

  it("maps contact and MCP requests onto the diagram", async () => {
    const { edgesFor } = await import("../public/js/lib.js");
    expect(edgesFor({ route: "POST /api/contact", status: 202 })).toEqual(["vi", "ia", "ar"]);
    expect(edgesFor({ route: "POST /mcp", status: 200 })).toEqual(["vi", "ia", "am"]);
  });
});

describe("scan helpers", () => {
  it("pulls the address out of an ICE candidate line", () => {
    expect(candidateAddress("candidate:1 1 udp 2122260223 192.168.0.12 54321 typ host generation 0")).toBe(
      "192.168.0.12",
    );
    expect(candidateAddress("a=candidate:2 1 udp 2122194687 3f1c.local 60000 typ host")).toBe("3f1c.local");
    expect(candidateAddress("")).toBeNull();
    expect(candidateAddress(undefined)).toBeNull();
  });

  it("sums the report up in one line, worst first", () => {
    expect(scanHeadline({ summary: { contradictions: 2, exposures: 3 } })).toMatch(/^2 contradições/);
    expect(scanHeadline({ summary: { contradictions: 0, exposures: 1 } })).toMatch(/1 coisa exposta/);
    expect(scanHeadline({ summary: { contradictions: 0, exposures: 0 } })).toMatch(/Raro/);
  });
});

describe("hex dump helpers", () => {
  it("maps each byte to its field, leaving gaps as -1", () => {
    const fields = [
      { offset: 0, length: 2, label: "a" },
      { offset: 3, length: 2, label: "b" },
    ];
    expect(fieldOfByte(6, fields)).toEqual([0, 0, -1, 1, 1, -1]);
  });

  it("explains every piece of a JA4", () => {
    const parts = ja4Parts("t13d1516h2_8daaf6152771_806a8c22fdea");
    expect(parts.map((p) => p.text).join("")).toBe("t13d1516h2_8daaf6152771_806a8c22fdea");
    expect(parts.map((p) => p.meaning)).toEqual([
      "TCP",
      "TLS 1.3",
      "com nome de domínio (SNI)",
      "15 cifras",
      "16 extensões",
      "ALPN h2",
      "hash das cifras, ordenadas",
      "hash das extensões e assinaturas",
    ]);
    expect(ja4Parts("lixo")).toEqual([]);
  });

  it("reads whole server-sent events and keeps the unfinished tail for the next chunk", () => {
    const first = parseSse('event: passages\ndata: {"n":1}\n\nevent: text\ndata: {"delta":"Ol');
    expect(first.events).toEqual([{ event: "passages", data: { n: 1 } }]);
    const second = parseSse(first.rest + 'á"}\r\n\r\n: keep-alive\n\ndata: {"x":2}\n\n');
    expect(second.events).toEqual([
      { event: "text", data: { delta: "Olá" } },
      { event: "message", data: { x: 2 } },
    ]);
    expect(second.rest).toBe("");
  });
});
