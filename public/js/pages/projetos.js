import { api } from "../api.js";
import { el, renderBlocks } from "../dom.js";
import { markdownBlocks, sections } from "../lib.js";

/** /projetos: tag filter, master list and the selected project's full text from /api/projects/:slug. */
export function createProjetosPage({ root, act, go }) {
  const $ = (sel) => root.querySelector(sel);
  let projects = null;
  let tag = "todas";
  let selected = null;
  const details = new Map(); // slug → full project, fetched once

  async function ensureList() {
    if (projects) return;
    const { body } = await api("/api/projects", { auto: true });
    projects = body;
  }

  function visible() {
    return projects.filter((p) => tag === "todas" || p.tags.includes(tag));
  }

  function renderFilters() {
    const tags = ["todas", ...new Set(projects.flatMap((p) => p.tags))];
    $("#proj-filters").replaceChildren(
      ...tags.map((t) =>
        el(
          "button",
          {
            type: "button",
            class: "toggle-chip",
            attrs: { "aria-pressed": String(t === tag) },
            on: {
              click: () => {
                tag = t;
                const list = visible();
                if (!list.some((p) => p.slug === selected)) selected = list[0]?.slug ?? null;
                render();
              },
            },
          },
          t,
          el(
            "span",
            { class: "chip-count" },
            String(t === "todas" ? projects.length : projects.filter((p) => p.tags.includes(t)).length),
          ),
        ),
      ),
    );
  }

  function renderList() {
    $("#proj-list").replaceChildren(
      ...visible().map((p) =>
        el(
          "button",
          {
            type: "button",
            class: "master-item",
            attrs: { role: "option", "aria-selected": String(p.slug === selected) },
            on: { click: () => go("projetos", p.slug) },
          },
          el("span", { class: "master-meta" }, `${number(p)} · ${p.tags.join(" · ")}`),
          el("span", { class: "master-name" }, p.name),
          el("span", { class: "master-sub" }, p.summary),
        ),
      ),
    );
  }

  async function renderDetail() {
    const summary = projects.find((p) => p.slug === selected);
    const detail = $("#proj-detail");
    if (!summary) {
      detail.replaceChildren(el("p", { class: "muted" }, "Nenhum projeto com essa área."));
      return;
    }
    if (!details.has(summary.slug)) {
      const { res, body } = await api(`/api/projects/${encodeURIComponent(summary.slug)}`, { auto: true });
      if (!res.ok) return;
      details.set(summary.slug, body);
    }
    if (summary.slug !== selected) return; // the visitor picked another one meanwhile
    const p = details.get(summary.slug);

    const actions = el(
      "div",
      { class: "detail-actions" },
      el(
        "button",
        {
          type: "button",
          class: "btn btn-primary",
          on: { click: () => act({ type: "run", target: `cat ${p.slug}` }) },
        },
        "Abrir no terminal",
      ),
      el(
        "button",
        {
          type: "button",
          class: "btn btn-line btn-mono",
          on: { click: () => act({ type: "run", target: `ask "como funciona o ${p.slug}?"` }) },
        },
        el("span", { class: "accent", attrs: { "aria-hidden": "true" } }, "$"),
        "ask sobre ele",
      ),
    );
    if (p.repo)
      actions.append(
        el("a", { class: "btn btn-line btn-mono", href: p.repo, target: "_blank", rel: "noopener" }, "repo ↗"),
      );

    detail.replaceChildren(
      el(
        "div",
        { class: "detail-head" },
        el("span", { class: "master-meta" }, `${number(p)} · ${p.tags.join(" · ")}`),
        el("h2", { id: "pd-name" }, p.name),
        el("p", { class: "detail-summary" }, p.summary),
        el(
          "ul",
          { class: "stack", attrs: { "aria-label": "Stack" } },
          p.stack.map((s) => el("li", {}, s)),
        ),
      ),
      actions,
      el("div", { class: "rule-inline", attrs: { "aria-hidden": "true" } }),
      ...sections(p.body).map(([title, text]) =>
        el("section", { class: "detail-section" }, el("h3", {}, title), ...renderBlocks(markdownBlocks(text))),
      ),
    );
  }

  const number = (p) => String(projects.indexOf(projects.find((x) => x.slug === p.slug)) + 1).padStart(2, "0");

  function render() {
    renderFilters();
    renderList();
    renderDetail().catch(() => {});
  }

  return {
    root,
    async enter(param) {
      try {
        await ensureList();
      } catch {
        return;
      }
      if (param && projects.some((p) => p.slug === param)) {
        selected = param;
        if (!visible().some((p) => p.slug === param)) tag = "todas";
      }
      selected ??= projects[0]?.slug ?? null;
      render();
    },
  };
}
