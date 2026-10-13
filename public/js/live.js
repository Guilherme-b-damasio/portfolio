import { api } from "./api.js";
import { el, svg } from "./dom.js";
import { ago, clock, formatUptime, hourStrip, sparkPoints } from "./lib.js";

/** Hero facts, the "Ao vivo" cards, the routes table and the footer, all from /api/status. */
export function createLivePanel({ facts, stats, routes, lastRead, footer, onStatus }) {
  let history = { intervalSeconds: 300, points: [] };

  async function refreshHistory() {
    try {
      const { res, body } = await api("/api/status/history");
      if (res.ok) history = body;
    } catch {
      /* sparklines keep the previous series */
    }
  }

  async function refresh() {
    let status;
    try {
      const { res, body } = await api("/api/status");
      if (!res.ok) return;
      status = body;
    } catch {
      return; // best-effort: the next tick retries
    }
    onStatus(status);
    renderFacts(status);
    renderStats(status);
    renderRoutes(status);
    lastRead.textContent = clock(new Date());
    footer.build.textContent = status.build.commit.slice(0, 7);
    footer.rest.textContent = ` · node ${status.runtime.node} · pod …${status.runtime.pod.slice(-5)}`;
  }

  function renderFacts(s) {
    const rows = [
      ["pod", s.runtime.pod],
      ["nó", s.runtime.node_name ? `${s.runtime.node_name} · k3s` : "local"],
      ["uptime", formatUptime(s.uptimeSeconds)],
      ["req/min", String(s.requestsLastMinute)],
      ["commit", [s.build.commit.slice(0, 7), ago(s.build.builtAt)].filter(Boolean).join(" · ")],
    ];
    facts.replaceChildren(...rows.map(([k, v]) => el("div", { class: "fact" }, el("span", {}, k), el("span", {}, v))));
  }

  function renderStats(s) {
    const points = history.points;
    const span = points.length > 1 ? formatUptime(Math.round((points.at(-1).t - points[0].t) / 1000)) : null;
    const rpm = [...points.map((p) => p.requestsLastMinute), s.requestsLastMinute];
    const rss = [...points.map((p) => p.rssMb), s.memory.rssMb];
    const hours = hourStrip(points);

    stats.replaceChildren(
      card({
        label: "uptime",
        value: formatUptime(s.uptimeSeconds),
        sub: "desde que este pod subiu",
        viz: strip(hours),
        caption: ["24h", `${hours.filter(Boolean).length}/24 h com amostra`],
      }),
      card({
        label: "requests no último minuto",
        value: String(s.requestsLastMinute),
        sub: span ? `pico em ${span}: ${Math.max(...rpm)}` : "pico: ainda coletando",
        viz: spark(rpm, `requests por minuto em ${span ?? "coleta"}`),
        caption: [span ?? "coletando", "agora"],
      }),
      card({
        label: "memória (rss)",
        value: `${s.memory.rssMb} MB`,
        sub: `heap ${s.memory.heapUsedMb} MB`,
        viz: spark(rss, `memória em ${span ?? "coleta"}`),
        caption: [span ?? "coletando", "agora"],
      }),
      card({
        label: "pod que te atendeu",
        value: s.runtime.pod.slice(-11),
        sub:
          [s.runtime.node_name, s.runtime.namespace && `ns ${s.runtime.namespace}`].filter(Boolean).join(" · ") ||
          "host",
        viz: el(
          "div",
          { class: "pod-viz", attrs: { role: "img", "aria-label": "a réplica que respondeu está pronta" } },
          el("span"),
        ),
        caption: ["réplica", "pronta"],
      }),
    );
  }

  function renderRoutes(s) {
    const rows = s.routes
      .filter((r) => !r.route.endsWith("static"))
      .sort((a, b) => b.count - a.count)
      .map((r) => {
        const [method, ...path] = r.route.split(" ");
        return el(
          "tr",
          {},
          el("td", {}, el("span", { class: "muted" }, `${method} `), path.join(" ")),
          el("td", {}, String(r.count)),
          el("td", {}, `${r.p50Ms}ms`),
          el("td", {}, `${r.p95Ms}ms`),
          el("td", { class: r.errors ? "wide err" : "wide muted" }, String(r.errors)),
        );
      });
    routes.replaceChildren(...rows);
  }

  refreshHistory().then(refresh);
  setInterval(refresh, 5000);
  setInterval(refreshHistory, 60_000);
}

function card({ label, value, sub, viz, caption }) {
  return el(
    "div",
    { class: "cell stat" },
    el("span", { class: "stat-label" }, label),
    el("span", { class: "stat-value" }, value),
    el("span", { class: "stat-sub" }, sub),
    el(
      "div",
      { class: "stat-viz" },
      viz,
      el("div", { class: "stat-caption" }, el("span", {}, caption[0]), el("span", {}, caption[1])),
    ),
  );
}

function spark(values, label) {
  const pts = sparkPoints(values);
  if (!pts) return el("div", { class: "spark-empty" }, "1 ponto a cada 5 min");
  return svg(
    "svg",
    { class: "spark", viewBox: "0 0 100 30", preserveAspectRatio: "none", role: "img", "aria-label": label },
    svg("polygon", { points: pts.area }),
    svg("polyline", { points: pts.line, "vector-effect": "non-scaling-stroke" }),
  );
}

function strip(hours) {
  const on = hours.filter(Boolean).length;
  return el(
    "div",
    { class: "strip", attrs: { role: "img", "aria-label": `${on} das últimas 24 horas com amostra` } },
    hours.map((up, i) => el("span", { class: i === 23 ? "now" : up ? "on" : "" })),
  );
}
