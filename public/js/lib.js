// Pure helpers: no DOM, no fetch. Covered by tests/frontend-lib.test.ts.

export const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function formatUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

export const clock = (date) => date.toTimeString().slice(0, 8);

export function formatMs(ms) {
  return ms >= 100 ? `${Math.round(ms)}ms` : `${Math.round(ms * 10) / 10}ms`;
}

/** "há 2h", "há 3d": how long ago an ISO timestamp was, from `now`. */
export function ago(iso, now = Date.now()) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 3600) return `há ${Math.max(1, Math.round(s / 60))}min`;
  if (s < 86400) return `há ${Math.round(s / 3600)}h`;
  return `há ${Math.round(s / 86400)}d`;
}

/** Polyline and area points for a 100×30 sparkline viewBox. */
export function sparkPoints(values) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = 100 / (values.length - 1);
  const pts = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(2 + (1 - (v - min) / (max - min || 1)) * 26).toFixed(1)}`,
  );
  return { line: pts.join(" "), area: `0,30 ${pts.join(" ")} 100,30` };
}

/**
 * Which of the last 24 hours had at least one sample, oldest first.
 * Hours before the process started are unknown, not "down": the strip says so.
 */
export function hourStrip(points, now = Date.now()) {
  const hour = 3_600_000;
  return Array.from({ length: 24 }, (_, i) => {
    const end = now - (23 - i) * hour;
    return points.some((p) => p.t > end - hour && p.t <= end);
  });
}

/** Groups a request the way the server's metrics do, e.g. GET /api/projects/:slug. */
export function routeLabel(method, path) {
  const clean = path.split("?")[0];
  const normalized = clean.replace(/^\/api\/projects\/[^/]+$/, "/api/projects/:slug");
  return `${method} ${normalized}`;
}

/** Edges of the architecture diagram a request travelled through. */
export function edgesFor({ route, status, generated }) {
  if (status === 404) return ["vi", "ia"];
  if (route === "POST /api/ask") {
    // Turned away by the rate limit or the concurrency cap before reaching the search.
    if (status === 429 || status === 503) return ["vi", "ia", "ar"];
    return generated ? ["vi", "ia", "ar", "rb", "bc"] : ["vi", "ia", "ar", "rb"];
  }
  if (/^GET \/api\/(status|ask\/quota)/.test(route) || route === "GET /metrics" || route === "GET /healthz") {
    return ["vi", "ia", "ax"];
  }
  if (route === "POST /api/contact") return status === 202 ? ["vi", "ia", "ar"] : ["vi", "ia"];
  if (route === "POST /mcp") return ["vi", "ia", "am"];
  if (route.startsWith("GET /api/")) return ["vi", "ia", "am"];
  return ["vi", "ia"];
}

/** Splits a project body on its "## " headings: [[title, text], ...]. Text before the first heading is dropped. */
export function sections(body) {
  return body
    .split(/^## /m)
    .slice(1)
    .map((s) => {
      const [title, ...rest] = s.split("\n");
      return [title.trim(), rest.join("\n").trim()];
    });
}

/** Command line → words, keeping "quoted strings" together and without their quotes. */
export function parseLine(line) {
  return (line.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ""));
}

/** "você quis dizer" for a mistyped command, or undefined. */
export function guessCommand(name, commands) {
  return commands.find(
    (c) =>
      c[0] === name[0] &&
      Math.abs(c.length - name.length) <= 2 &&
      [...name].filter((ch) => c.includes(ch)).length >= c.length - 1,
  );
}

/** Splits text around the query terms BM25 matched: [{ text, mark }]. Matching ignores accents and case. */
export function highlightParts(text, terms) {
  if (!terms.length) return [{ text, mark: false }];
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = [];
  let last = 0;
  for (const m of fold(text).matchAll(pattern)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), mark: false });
    parts.push({ text: text.slice(m.index, m.index + m[0].length), mark: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mark: false });
  return parts;
}

/** Splits an answer around its citations like [docsage.md › O que é]: [{ text, source? }]. */
export function citationParts(text) {
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(/\[([\w.-]+\.md(?: › [^\]]+)?)\]/g)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], source: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The terminal command that opens a cited source: `cat docsage "Decisões técnicas"`, or `whoami` for the profile. */
export function commandForSource(source) {
  const [file, section] = source.split(" › ");
  const slug = file.replace(/\.md$/, "");
  if (slug === "profile") return "whoami";
  return section ? `cat ${slug} "${section}"` : `cat ${slug}`;
}

export const PAGES = ["inicio", "sobre", "projetos", "mcp", "contato", "voce"];

/** "#/projetos/docsage" → { page: "projetos", param: "docsage" }. Plain anchors like "#terminal" stay on the home page. */
export function parseRoute(hash) {
  const match = /^#\/([\w-]+)(?:\/([\w-]+))?/.exec(hash ?? "");
  if (!match || !PAGES.includes(match[1])) {
    const anchor = hash && hash.startsWith("#") && !hash.startsWith("#/") ? hash.slice(1) : null;
    return { page: "inicio", param: null, anchor };
  }
  return { page: match[1], param: match[2] ?? null, anchor: null };
}

/** Inline **bold** → [{ text, bold }]. */
export function inlineParts(text) {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((t) =>
      t.startsWith("**") && t.endsWith("**") ? { text: t.slice(2, -2), bold: true } : { text: t, bold: false },
    );
}

/**
 * The little Markdown the content uses, as blocks: "### " headings, "- " bullets, TODO notes and paragraphs
 * (consecutive lines join). Rendered with text nodes only, never as HTML.
 */
export function markdownBlocks(text) {
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "p", parts: inlineParts(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) flush();
    else if (line.startsWith("### ")) {
      flush();
      blocks.push({ type: "h3", text: line.slice(4) });
    } else if (line.startsWith("- ")) {
      flush();
      blocks.push({ type: "li", parts: inlineParts(line.slice(2)) });
    } else if (/^TODO\b/.test(line)) {
      flush();
      blocks.push({ type: "todo", text: line });
    } else paragraph.push(line);
  }
  flush();
  return blocks;
}

/** Same rules as POST /api/contact, so the visitor sees mistakes before spending a send. */
export function validateContact({ name, email, message }) {
  const errors = {};
  if (!name.trim()) errors.name = "Diga seu nome.";
  else if ([...name].some((c) => c.charCodeAt(0) < 32)) errors.name = "Use só uma linha.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Esse e-mail não parece válido.";
  if (message.trim().length < 20) errors.message = "Escreva pelo menos 20 caracteres.";
  else if (message.trim().length > 1000) errors.message = "No máximo 1000 caracteres.";
  return errors;
}

/** What to paste in each MCP client to connect to this site. */
export function installSnippet(client, url) {
  if (client === "code") return `claude mcp add --transport http portfolio ${url}`;
  return JSON.stringify({ mcpServers: { portfolio: { command: "npx", args: ["mcp-remote", url] } } }, null, 2);
}

/** "candidate:1 1 udp 2122260223 192.168.0.12 54321 typ host ..." → "192.168.0.12" (the fifth field). */
export function candidateAddress(candidate) {
  const parts = (candidate ?? "").replace(/^a=/, "").split(" ");
  return parts.length > 7 && parts[6] === "typ" ? parts[4] : null;
}

// Worst first, as the server sorts the findings.
export const VERDICTS = { contradicao: "contradição", exposto: "exposto", info: "info", ok: "ok" };

/** One line for the top of the report: the overall reading, from the server's counts. */
export function scanHeadline({ summary }) {
  const { contradictions, exposures } = summary;
  if (contradictions) {
    return `${contradictions} ${contradictions === 1 ? "contradição" : "contradições"} entre as camadas: algo aqui foi falsificado ou automatizado.`;
  }
  if (exposures)
    return `Nada falsificado, mas ${exposures} ${exposures === 1 ? "coisa exposta" : "coisas expostas"} que dá para esconder.`;
  return "Nada contraditório e nada exposto que dê para esconder. Raro.";
}

/** For each byte of the dump, the index of the field it belongs to (or -1), from the server's annotations. */
export function fieldOfByte(byteCount, fields) {
  const owner = new Array(byteCount).fill(-1);
  fields.forEach((f, i) => {
    for (let b = f.offset; b < Math.min(byteCount, f.offset + f.length); b++) owner[b] = i;
  });
  return owner;
}

const TLS_VERSIONS = { 13: "TLS 1.3", 12: "TLS 1.2", 11: "TLS 1.1", 10: "TLS 1.0", s3: "SSL 3", s2: "SSL 2" };

/** "t13d1516h2_8daaf6152771_806a8c22fdea" → each piece with what it means, for the page to explain. */
export function ja4Parts(ja4) {
  const m = /^([tqd])(\w\w)([di])(\d\d)(\d\d)(\w\w)_(\w{12})_(\w{12})$/.exec(ja4 ?? "");
  if (!m) return [];
  const [, proto, version, sni, ciphers, extensions, alpn, cipherHash, extHash] = m;
  return [
    { text: proto, meaning: proto === "t" ? "TCP" : proto === "q" ? "QUIC" : "DTLS" },
    { text: version, meaning: TLS_VERSIONS[version] ?? "versão desconhecida" },
    { text: sni, meaning: sni === "d" ? "com nome de domínio (SNI)" : "sem SNI, por IP" },
    { text: ciphers, meaning: `${Number(ciphers)} cifras` },
    { text: extensions, meaning: `${Number(extensions)} extensões` },
    { text: alpn, meaning: alpn === "00" ? "sem ALPN" : `ALPN ${alpn}` },
    { text: `_${cipherHash}`, meaning: "hash das cifras, ordenadas" },
    { text: `_${extHash}`, meaning: "hash das extensões e assinaturas" },
  ];
}

/**
 * Reads complete server-sent events out of what has arrived so far. Returns them with the
 * unfinished tail, which goes back in front of the next chunk. Only `event:` and `data:` matter here.
 */
export function parseSse(buffer) {
  const blocks = buffer.replaceAll("\r\n", "\n").split("\n\n");
  const rest = blocks.pop();
  const events = [];
  for (const block of blocks) {
    let event = "message";
    const data = [];
    for (const field of block.split("\n")) {
      if (field.startsWith("event:")) event = field.slice(6).trim();
      else if (field.startsWith("data:")) data.push(field.slice(5).replace(/^ /, ""));
    }
    if (!data.length) continue; // a comment or keep-alive
    try {
      events.push({ event, data: JSON.parse(data.join("\n")) });
    } catch {
      /* not JSON: not one of ours */
    }
  }
  return { events, rest };
}
