import { api } from "./api.js";
import { el } from "./dom.js";
import { clock, formatMi, formatMilli, kubeAge, percentOf } from "./lib.js";

/**
 * The "Cluster" block under the live panel: the node with its CPU and memory against capacity,
 * then every visible pod. It only polls /api/cluster once /api/status says the pod can read it.
 */
export function createClusterPanel({ note, nodes, wrap, pods }) {
  let timer = null;

  async function refresh() {
    let body;
    try {
      const { res, body: b } = await api("/api/cluster", { auto: true });
      if (!res.ok) {
        note.textContent = b?.error ?? `a API do cluster respondeu ${res.status}`;
        return;
      }
      body = b;
    } catch {
      return; // best-effort: the next tick retries
    }
    note.textContent = `lido da API do Kubernetes às ${clock(new Date(body.readAt))} · namespaces ${body.namespaces.join(", ")} · só leitura`;
    nodes.replaceChildren(...body.nodes.map(nodeCard));
    pods.replaceChildren(...body.pods.map(podRow));
    wrap.hidden = !body.pods.length;
  }

  return {
    /** Called with every /api/status: starts polling the first time the cluster is on. */
    setStatus(status) {
      if (!status.cluster) {
        note.textContent = "este processo não está rodando no k3s agora; o painel acende quando estiver";
        return;
      }
      if (timer) return;
      refresh();
      timer = setInterval(refresh, 15_000);
    },
  };
}

function nodeCard(n) {
  return el(
    "div",
    { class: "cell node" },
    el(
      "div",
      { class: "node-head" },
      el("span", { class: "mono strong" }, n.name),
      el("span", { class: n.ready ? "node-ok" : "node-bad" }, n.ready ? "Ready" : "NotReady"),
      el("span", { class: "muted mono" }, `${n.kubeletVersion} · ${kubeAge(n.createdAt)}`),
    ),
    gauge("CPU", n.cpuUsageMilli, n.cpuCapacityMilli, formatMilli),
    gauge("memória", n.memoryUsageBytes, n.memoryCapacityBytes, formatMi),
  );
}

function gauge(label, used, capacity, format) {
  const pct = percentOf(used, capacity);
  const text =
    pct == null ? `sem metrics-server · ${format(capacity)}` : `${format(used)} de ${format(capacity)} (${pct}%)`;
  // The fill's width goes through the CSSOM, which the CSP allows (inline style attributes it does not).
  const fill = el("span");
  fill.style.width = `${Math.min(pct ?? 0, 100)}%`;
  return el(
    "div",
    { class: "gauge" },
    el("span", { class: "muted" }, label),
    el("span", { class: "gauge-bar", attrs: { role: "img", "aria-label": `${label}: ${text}` } }, fill),
    el("span", { class: "mono" }, text),
  );
}

function podRow(p) {
  return el(
    "tr",
    {},
    el("td", {}, el("span", { class: "muted" }, `${p.namespace}/`), p.name),
    el("td", {}, p.ready),
    el("td", { class: p.phase === "Running" || p.phase === "Succeeded" ? "" : "err" }, p.phase),
    el("td", { class: p.restarts ? "err" : "" }, String(p.restarts)),
    el("td", {}, kubeAge(p.startedAt)),
    el("td", { class: "wide" }, formatMilli(p.cpuUsageMilli)),
    el("td", { class: "wide" }, formatMi(p.memoryUsageBytes)),
  );
}
