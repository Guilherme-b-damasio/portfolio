import { api } from "../api.js";
import { el } from "../dom.js";
import { ago, formatMs } from "../lib.js";

/** /evals: the questions CI asks the RAG, scored now against the index this server is serving. */
export function createEvalsPage({ root, act }) {
  const $ = (sel) => root.querySelector(sel);
  let engine = "local";
  let engines = [];
  let loading = false;

  async function load() {
    if (loading) return;
    loading = true;
    $("#evals-state").textContent = "rodando…";
    try {
      const { res, body } = await api(`/api/evals?engine=${encodeURIComponent(engine)}`);
      if (!res.ok) {
        $("#evals-state").textContent = body?.error ?? `erro ${res.status}`;
        return;
      }
      engines = body.engines;
      renderTabs();
      render(body.report);
    } catch {
      $("#evals-state").textContent = "não consegui falar com o servidor";
    } finally {
      loading = false;
    }
  }

  function renderTabs() {
    const tabs = $("#evals-engines");
    tabs.hidden = engines.length < 2;
    tabs.replaceChildren(
      ...engines.map((name) =>
        el(
          "button",
          {
            type: "button",
            attrs: { role: "tab", "aria-selected": String(name === engine) },
            on: {
              click: () => {
                if (name === engine) return;
                engine = name;
                load();
              },
            },
          },
          name,
        ),
      ),
    );
  }

  function stat(label, value, sub) {
    return el(
      "div",
      { class: "cell stat" },
      el("span", { class: "stat-label" }, label),
      el("span", { class: "stat-value" }, value),
      el("span", { class: "stat-sub" }, sub),
    );
  }

  function render(report) {
    $("#evals-state").textContent = `rodado ${ago(report.ranAt)} · engine ${report.engine}`;
    if (report.error) {
      $("#evals-stats").replaceChildren(stat("engine", "fora", report.error));
      $("#evals-rows").replaceChildren();
      return;
    }
    const hits = report.cases.filter((c) => c.rank !== null).length;
    $("#evals-stats").replaceChildren(
      stat(
        `recall@${report.k}`,
        report.recall.toFixed(2),
        `mínimo ${report.minRecall} · ${report.passed ? "passa" : "reprova"}`,
      ),
      stat("MRR", report.mrr.toFixed(2), "1 = sempre em primeiro"),
      stat("acertos", `${hits}/${report.cases.length}`, `em ${formatMs(report.ms)}, sem LLM`),
    );
    $("#evals-rows").replaceChildren(
      ...report.cases.map((c) => {
        const question = el(
          "button",
          {
            type: "button",
            class: "link-btn",
            title: "perguntar no terminal",
            on: { click: () => act({ type: "run", target: `ask "${c.question.replaceAll('"', "")}"` }) },
          },
          c.question,
        );
        const detail =
          c.rank === null
            ? el(
                "span",
                { class: "eval-miss" },
                `esperava ${c.expected.join(" ou ")} · veio ${c.retrieved.join(", ") || "nada"}`,
              )
            : el("span", { class: "eval-miss" }, c.retrieved[c.rank - 1]);
        return el(
          "tr",
          {},
          el("td", {}, question, detail),
          el("td", { class: c.rank === null ? "err" : "" }, c.rank === null ? "erro" : `#${c.rank}`),
        );
      }),
    );
  }

  return {
    root,
    enter() {
      load();
    },
  };
}
