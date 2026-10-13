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
    if (status === 429) return ["vi", "ia", "ar"];
    return generated ? ["vi", "ia", "ar", "rb", "bc"] : ["vi", "ia", "ar", "rb"];
  }
  if (/^GET \/api\/(status|ask\/quota)/.test(route) || route === "GET /metrics" || route === "GET /healthz") {
    return ["vi", "ia", "ax"];
  }
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
