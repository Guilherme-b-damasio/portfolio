// Plain JS so it can import public/js/lib.js as the browser does, without type declarations.
import { describe, expect, it } from "vitest";
import {
  ago,
  bucketFromHeaders,
  bucketGlyphs,
  deployStages,
  formatGap,
  candidateAddress,
  citationParts,
  crowdHeadline,
  crowdLine,
  commandForSource,
  edgesFor,
  explainTerm,
  fieldOfByte,
  formatUptime,
  formatUsd,
  guessCommand,
  manualSections,
  grepLines,
  jqLines,
  jqSteps,
  parsePipeline,
  savedHistory,
  splitPipes,
  formatAttrs,
  highlightParts,
  hourStrip,
  ja4Parts,
  formatMi,
  formatMilli,
  kubeAge,
  latencyStrip,
  nodeRows,
  percentOf,
  podRows,
  parseLine,
  parseSse,
  rankShift,
  rememberTurn,
  leakProbeUrl,
  resolverParts,
  routeLabel,
  scanHeadline,
  scoreBar,
  sections,
  sparkPoints,
  takeFlag,
  takeOption,
  waterfallRows,
} from "../public/js/lib.js";

describe("ask --xray helpers", () => {
  it("pulls a flag out wherever it was typed", () => {
    expect(takeFlag(["--xray", "o que é?"], "--xray")).toEqual({ on: true, rest: ["o que é?"] });
    expect(takeFlag(["o", "que", "--xray"], "--xray")).toEqual({ on: true, rest: ["o", "que"] });
    expect(takeFlag(["o que é?"], "--xray")).toEqual({ on: false, rest: ["o que é?"] });
  });

  it("pulls an option and its value out wherever it was typed", () => {
    expect(takeOption(["--engine", "docsage", "o que é?"], "--engine")).toEqual({
      value: "docsage",
      rest: ["o que é?"],
    });
    expect(takeOption(["o que é?", "--engine"], "--engine")).toEqual({ value: "", rest: ["o que é?"] });
    expect(takeOption(["o que é?"], "--engine")).toEqual({ value: null, rest: ["o que é?"] });
  });

  it("keeps four decimals under a dollar", () => {
    expect(formatUsd(0.0108)).toBe("US$ 0.0108");
    expect(formatUsd(1.5)).toBe("US$ 1.50");
  });

  it("draws scores relative to the best one, never empty for a match", () => {
    expect(scoreBar(4, 4, 4)).toBe("████");
    expect(scoreBar(2, 4, 4)).toBe("██░░");
    expect(scoreBar(0.01, 4, 4)).toBe("█░░░");
  });
});

describe("follow-up memory", () => {
  it("keeps the newest turns and trims long answers to what the server accepts", () => {
    let turns = [];
    for (const n of [1, 2, 3, 4]) turns = rememberTurn(turns, { question: `q${n}`, answer: `a${n}` });
    expect(turns.map((t) => t.question)).toEqual(["q2", "q3", "q4"]);
    expect(rememberTurn([], { question: "q", answer: "x".repeat(2000) })[0].answer).toHaveLength(1500);
  });
});

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
    expect(routeLabel("GET", "/api/dns-leak/0123456789abcdef")).toBe("GET /api/dns-leak/:token");
  });

  it("lights the claude edge only when an answer was generated", () => {
    expect(edgesFor({ route: "POST /api/ask", status: 200, generated: true })).toContain("bc");
    expect(edgesFor({ route: "POST /api/ask", status: 200, generated: false })).not.toContain("bc");
    expect(edgesFor({ route: "POST /api/ask", status: 429 })).toEqual(["vi", "ia", "ar"]);
    expect(edgesFor({ route: "POST /api/ask", status: 503 })).toEqual(["vi", "ia", "ar"]);
    expect(edgesFor({ route: "GET /api/status", status: 200 })).toEqual(["vi", "ia", "ax"]);
    expect(edgesFor({ route: "GET /api/projects/:slug", status: 404 })).toEqual(["vi", "ia"]);
    expect(edgesFor({ route: "GET /api/lab/search", status: 200 })).toEqual(["vi", "ia", "ar", "rb"]);
    expect(edgesFor({ route: "GET /api/lab/search", status: 429 })).toEqual(["vi", "ia"]);
    expect(edgesFor({ route: "POST /api/lab/load", status: 200 })).toEqual(["vi", "ia"]);
  });

  it("draws load samples as blocks scaled to the slowest, failures as ×, keeping only the latest", () => {
    const sample = (ms, status = 200) => ({ ms, status });
    // A timed-out request (ms 2000) does not flatten the scale of the ones that answered.
    expect(latencyStrip([sample(1), sample(4), sample(8), sample(2000, 0), sample(3, 503)])).toBe("▂▅█××");
    expect(latencyStrip([sample(5), sample(1), sample(2)], 2)).toBe("▅█");
    expect(latencyStrip([sample(0)])).toBe("▁");
    expect(latencyStrip([])).toBe("");
  });

  it("says where a playground hit moved against the default ranking, and why it scored", () => {
    expect([rankShift(1, 1), rankShift(1, 3), rankShift(4, 2), rankShift(2, null)]).toEqual(["=", "↑2", "↓2", "novo"]);
    expect(explainTerm({ term: "flux", tf: 2, df: 1, idf: 1.1, score: 1.5234 })).toBe(
      "flux tf 2 · df 1 · idf 1.10 → 1.52",
    );
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

  it("lays a trace out as a waterfall on one time axis", () => {
    const trace = {
      route: "POST /api/ask",
      status: 200,
      durationMs: 100,
      spans: [
        { name: "retrieve", startMs: 0, durationMs: 2, error: false, attrs: { engine: "local" } },
        { name: "generate", startMs: 50, durationMs: 50, error: true, attrs: {} },
      ],
    };
    expect(waterfallRows(trace, 10)).toEqual([
      { name: "POST /api/ask", pad: 0, bar: 10, ms: 100, error: false, attrs: {} },
      { name: "retrieve", pad: 0, bar: 1, ms: 2, error: false, attrs: { engine: "local" } },
      { name: "generate", pad: 5, bar: 5, ms: 50, error: true, attrs: {} },
    ]);
    // A span that starts at the very end still gets one visible cell inside the axis.
    const late = waterfallRows({ ...trace, spans: [{ ...trace.spans[0], startMs: 100, durationMs: 0 }] }, 10)[1];
    expect(late).toMatchObject({ pad: 9, bar: 1 });
  });

  it("prints span attributes without the empty ones", () => {
    expect(formatAttrs({ engine: "local", hits: 4, fallback: false, firstTokenMs: null })).toBe(
      "engine=local hits=4 fallback=false",
    );
  });

  it("marks the whole word a stem matched", () => {
    expect(highlightParts("Trabalho em times ágeis", ["trabalh", "tim"])).toEqual([
      { text: "Trabalho", mark: true },
      { text: " em ", mark: false },
      { text: "times", mark: true },
      { text: " ágeis", mark: false },
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

  it("says how many share one trait", () => {
    expect(crowdLine({ label: "sua GPU", oneIn: 12 })).toBe("1 em 12 visitantes tem sua GPU");
    expect(crowdLine({ label: "seu fuso", oneIn: 1 })).toBe("quase todo mundo tem seu fuso");
  });

  it("leads the crowd section with the rarest trait", () => {
    expect(crowdHeadline({ counted: 0, traits: [] })).toMatch(/Nenhum visitante contado ainda/);
    expect(crowdHeadline(null)).toMatch(/Nenhum visitante contado ainda/);
    expect(crowdHeadline({ counted: 1, traits: [] })).toMatch(/^1 visitante contado/);
    expect(crowdHeadline({ counted: 40, traits: [{ label: "sua GPU", oneIn: 20 }] })).toBe(
      "40 visitantes contados desde que o processo subiu. O mais raro: 1 em 20 visitantes tem sua GPU.",
    );
    expect(crowdHeadline({ counted: 40, traits: [{ label: "seu fuso", oneIn: 1 }] })).toMatch(
      /se parece com todo mundo/,
    );
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

describe("kubectl helpers", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const pod = {
    namespace: "portfolio",
    name: "portfolio-7d9f-abcde",
    phase: "Running",
    ready: "1/1",
    restarts: 2,
    startedAt: "2026-10-16T00:00:00Z",
    cpuUsageMilli: 3,
    memoryUsageBytes: 64 * 2 ** 20,
  };

  it("prints ages in kubectl's units", () => {
    expect(kubeAge("2026-10-17T11:59:15Z", now)).toBe("45s");
    expect(kubeAge("2026-10-17T11:48:00Z", now)).toBe("12m");
    expect(kubeAge("2026-10-17T09:00:00Z", now)).toBe("3h");
    expect(kubeAge("2026-10-12T12:00:00Z", now)).toBe("5d");
    expect(kubeAge(null, now)).toBe("<unknown>");
  });

  it("formats usage and leaves a dash without metrics-server", () => {
    expect(formatMilli(410)).toBe("410m");
    expect(formatMi(64 * 2 ** 20)).toBe("64Mi");
    expect(formatMi(1.5 * 2 ** 30)).toBe("1.5Gi");
    expect(formatMi(null)).toBe("–");
    expect(percentOf(410, 2000)).toBe(21);
    expect(percentOf(null, 2000)).toBeNull();
  });

  it("lays pods out in kubectl's columns", () => {
    expect(podRows([pod], { now })).toEqual([
      "NAME                   READY   STATUS    RESTARTS   AGE   CPU   MEMORY",
      "portfolio-7d9f-abcde   1/1     Running   2          36h   3m    64Mi",
    ]);
    expect(podRows([pod], { allNamespaces: true, now })[1]).toMatch(/^portfolio {3}portfolio-7d9f-abcde/);
  });

  it("shows node usage beside its share of the capacity", () => {
    const node = {
      name: "vps-1",
      ready: true,
      kubeletVersion: "v1.33.4+k3s1",
      createdAt: "2026-09-01T00:00:00Z",
      cpuCapacityMilli: 2000,
      memoryCapacityBytes: 4 * 2 ** 30,
      cpuUsageMilli: 410,
      memoryUsageBytes: 2 ** 30,
    };
    expect(nodeRows([node], now)[1]).toBe("vps-1   Ready    46d   v1.33.4+k3s1   410m (21%)   1.0Gi (25%)");
    expect(nodeRows([{ ...node, ready: false, cpuUsageMilli: null }], now)[1]).toMatch(/NotReady .* – {3}/);
  });
});

describe("formatGap", () => {
  it("prints the wait between two stages in the largest units that fit", () => {
    expect(formatGap("2026-10-17T17:00:00Z", "2026-10-17T17:00:45Z")).toBe("45s");
    expect(formatGap("2026-10-17T17:00:00Z", "2026-10-17T17:03:07Z")).toBe("3m07s");
    expect(formatGap("2026-10-17T17:00:00Z", "2026-10-17T19:05:00Z")).toBe("2h05m");
    expect(formatGap(null, "2026-10-17T17:00:00Z")).toBeNull();
  });
});

describe("deployStages", () => {
  const build = {
    status: "success",
    startedAt: "2026-10-17T17:18:53Z",
    finishedAt: "2026-10-17T17:19:39Z",
    url: "https://github.com/o/r/actions/runs/1",
  };
  const rollout = {
    revision: 5,
    image: "x:20261017171853-9eae1df",
    startedAt: "2026-10-17T17:21:04Z",
    readyAt: "2026-10-17T17:21:19Z",
    replicas: "1/1",
    current: true,
  };
  const stages = (d) => deployStages(d).map((s) => `${s.name}:${s.state}:${s.detail}`);

  it("follows a shipped change from commit to pod Ready, with the wait at each step", () => {
    const selectedAt = "2026-10-17T17:20:41Z";
    expect(stages({ committedAt: "2026-10-17T17:18:16Z", build, selectedAt, rollout })).toEqual([
      "commit:done:17:18",
      "imagem:done:46s",
      "tag:done:+1m02s",
      "flux:done:rev 5 +23s",
      "pod:done:+15s",
    ]);
  });

  it("times the rollout from the build when the tag's event has expired", () => {
    expect(stages({ committedAt: "2026-10-17T17:18:16Z", build, selectedAt: null, rollout }).slice(2, 4)).toEqual([
      "tag:unknown:",
      "flux:done:rev 5 +1m25s",
    ]);
  });

  it("waits for Flux after a good build and stops after a failed one", () => {
    expect(stages({ committedAt: "2026-10-17T17:18:16Z", build, rollout: null }).slice(2)).toEqual([
      "tag:waiting:aguardando o Flux",
      "flux:waiting:",
      "pod:waiting:",
    ]);
    expect(stages({ committedAt: null, build, selectedAt: "2026-10-17T17:20:41Z", rollout: null }).slice(2)).toEqual([
      "tag:done:+1m02s",
      "flux:waiting:aplicando a tag",
      "pod:waiting:",
    ]);
    expect(stages({ committedAt: null, build: { ...build, status: "failure" }, rollout: null }).slice(1)).toEqual([
      "imagem:failed:falhou",
      "tag:skipped:",
      "flux:skipped:",
      "pod:unknown:",
    ]);
    expect(
      stages({ committedAt: null, build: { ...build, status: "queued", finishedAt: null }, rollout: null })[1],
    ).toBe("imagem:running:na fila");
  });

  it("marks revisions that were replaced and ones older than GitHub's window", () => {
    const old = { ...rollout, readyAt: null, current: false };
    expect(stages({ committedAt: null, build: null, rollout: old })).toEqual([
      "commit:unknown:",
      "imagem:unknown:fora da janela do GitHub",
      "tag:unknown:",
      "flux:done:rev 5",
      "pod:replaced:substituído",
    ]);
  });
});

describe("rate limit lab helpers", () => {
  // Lower-cased names, as fetch's Headers hands them out.
  const Headers = class {
    constructor(init = {}) {
      this.map = new Map(Object.entries(init));
    }
    get(name) {
      return this.map.get(name) ?? null;
    }
  };

  it("reads the bucket from the response headers", () => {
    const shot = new Headers({
      "x-ratelimit-limit": "10",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "30",
      "retry-after": "3",
    });
    expect(bucketFromHeaders(shot)).toEqual({ limit: 10, remaining: 0, reset: 30, retryAfter: 3 });
    expect(bucketFromHeaders(new Headers({ "x-ratelimit-limit": "10", "x-ratelimit-remaining": "7" }))).toEqual({
      limit: 10,
      remaining: 7,
      reset: null,
      retryAfter: null,
    });
  });

  it("ignores responses without the headers or with garbage in them", () => {
    expect(bucketFromHeaders(new Headers())).toBeNull();
    expect(bucketFromHeaders(new Headers({ "x-ratelimit-limit": "ten", "x-ratelimit-remaining": "1" }))).toBeNull();
  });

  it("draws the tokens left, capped at a line", () => {
    expect(bucketGlyphs(3, 5)).toBe("●●●○○");
    expect(bucketGlyphs(0, 3)).toBe("○○○");
    expect(bucketGlyphs(9, 3)).toBe("●●●");
    expect(bucketGlyphs(50, 100)).toHaveLength(20);
  });
});

describe("DNS leak helpers", () => {
  it("describes each resolver by who it is, how it relates to you and what it forwarded", () => {
    const google = {
      address: "172.253.4.9",
      reverseDns: null,
      operator: "Google",
      relation: "publico",
      qtypes: ["A", "AAAA"],
      clientSubnet: { family: 4, address: "189.100.20.0", prefix: 24 },
      subnetHasYou: false,
    };
    expect(resolverParts(google)).toEqual({
      who: "172.253.4.9",
      relation: "Google (público)",
      subnet: "repassou 189.100.20.0/24, que não é a sua rede",
      qtypes: "A, AAAA",
    });
    const isp = {
      address: "201.17.0.53",
      reverseDns: "dns1.virtua.com.br",
      operator: null,
      relation: "mesma-rede",
      qtypes: ["A"],
      clientSubnet: null,
      subnetHasYou: null,
    };
    expect(resolverParts(isp)).toMatchObject({
      who: "201.17.0.53 · dns1.virtua.com.br",
      relation: "da sua rede",
      subnet: null,
    });
  });

  it("points the probe image at the name over https, never cached", () => {
    expect(leakProbeUrl("0123456789abcdef.leak.example.test", 42)).toBe(
      "https://0123456789abcdef.leak.example.test/p.gif?42",
    );
  });
});

describe("manual", () => {
  const page = {
    name: "ask",
    summary: "pergunta ao RAG",
    synopsis: ['ask "<pergunta>"', "ask [--xray]"],
    description: "Manda a pergunta para POST /api/ask.",
    options: [
      { flag: "--xray", text: "mostra cada etapa" },
      { flag: "--engine docsage|local", text: "troca o recuperador" },
    ],
    examples: ['ask "oi"'],
    seeAlso: ["search"],
  };

  it("lays the page out as sections, with the flags in one column", () => {
    expect(manualSections(page)).toEqual([
      ["sinopse", ['ask "<pergunta>"', "ask [--xray]"]],
      ["descrição", ["Manda a pergunta para POST /api/ask."]],
      ["opções", ["--xray                  mostra cada etapa", "--engine docsage|local  troca o recuperador"]],
    ]);
  });

  it("leaves out the options of a command that has none", () => {
    const plain = { ...page, options: undefined };
    expect(manualSections(plain).map(([heading]) => heading)).toEqual(["sinopse", "descrição"]);
    expect(manualSections({ ...plain, options: [] }).map(([heading]) => heading)).toEqual(["sinopse", "descrição"]);
  });
});

describe("pipelines", () => {
  it("splits on the pipes outside quotes", () => {
    expect(parsePipeline("curl /api/projects | jq .[].slug")).toEqual([
      ["curl", "/api/projects"],
      ["jq", ".[].slug"],
    ]);
    // A pipe inside a question belongs to the question, not to the shell.
    expect(splitPipes('ask "node | deno?" | grep node')).toEqual(['ask "node | deno?"', "grep node"]);
    expect(parsePipeline("status")).toEqual([["status"]]);
  });

  it("greps the captured lines, as a regex or as plain text", () => {
    const lines = ["uptime      3h", "memória     64 MB rss", "req/min     12"];
    expect(grepLines(lines, ["mem"]).lines).toEqual(["memória     64 MB rss"]);
    expect(grepLines(lines, ["^req"]).lines).toEqual(["req/min     12"]);
    expect(grepLines(lines, ["-i", "MEM"]).lines).toEqual(["memória     64 MB rss"]);
    expect(grepLines(lines, ["-v", "mem"]).lines).toEqual(["uptime      3h", "req/min     12"]);
    // An unfinished regex is read as text instead of throwing.
    expect(grepLines(["a(b", "c"], ["a(b"]).lines).toEqual(["a(b"]);
    expect(grepLines(lines, []).error).toMatch(/uso/);
  });

  it("reads a field out of the JSON a command printed", () => {
    const lines = ["HTTP 200 · 4 ms · application/json", "{", '  "name": "Guilherme",', '  "role": "backend"', "}"];
    expect(jqLines(lines, [".name"]).lines).toEqual(["Guilherme"]);
    expect(jqLines(lines, ["."]).lines[0]).toBe("{");
    expect(jqLines(["não é json"], [".name"]).error).toMatch(/não é JSON/);
  });

  it("walks arrays with [] and [n], and says where a filter does not fit", () => {
    const lines = ['[{ "slug": "docsage", "stack": ["node"] }, { "slug": "portfolio" }]'];
    expect(jqLines(lines, [".[].slug"]).lines).toEqual(["docsage", "portfolio"]);
    expect(jqLines(lines, [".[0].stack[0]"]).lines).toEqual(["node"]);
    expect(jqLines(lines, [".[1].stack"]).lines).toEqual(["null"]);
    expect(jqLines(lines, [".slug"]).error).toMatch(/'slug' não existe/);
    expect(jqSteps("slug").error).toMatch(/começa com '\.'/);
    expect(jqSteps(".a.b")).toEqual({ steps: [{ field: "a" }, { field: "b" }] });
  });

  it("keeps the saved history usable whatever is in storage", () => {
    expect(savedHistory('["status", "help"]')).toEqual(["status", "help"]);
    expect(savedHistory(null)).toEqual([]);
    expect(savedHistory("{")).toEqual([]);
    expect(savedHistory('["ok", 7, "", null]')).toEqual(["ok"]);
    expect(savedHistory(JSON.stringify(Array.from({ length: 80 }, (_, i) => `c${i}`)), 50)).toHaveLength(50);
  });
});
