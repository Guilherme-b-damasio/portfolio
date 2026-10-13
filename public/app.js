import { api } from "./js/api.js";
import { createDiagram } from "./js/diagram.js";
import { el, icon } from "./js/dom.js";
import { createLivePanel } from "./js/live.js";
import { createContatoPage } from "./js/pages/contato.js";
import { createMcpPage } from "./js/pages/mcp.js";
import { createProjetosPage } from "./js/pages/projetos.js";
import { createSobrePage } from "./js/pages/sobre.js";
import { createVocePage } from "./js/pages/voce.js";
import { createRequestsPanel } from "./js/requests-panel.js";
import { createRouter } from "./js/router.js";
import { createTerminal } from "./js/terminal.js";

const $ = (id) => document.getElementById(id);

// ---------- theme ----------
const root = document.documentElement;
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => root.dataset.theme ?? (systemDark.matches ? "dark" : "light");
function renderThemeButton() {
  const dark = currentTheme() === "dark";
  const label = dark ? "Mudar para tema claro" : "Mudar para tema escuro";
  $("theme").replaceChildren(icon(dark ? "sun" : "moon", 18));
  $("theme").setAttribute("aria-label", label);
  $("theme").title = label;
}
$("theme").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    /* the choice just won't survive a reload */
  }
  renderThemeButton();
});
systemDark.addEventListener("change", renderThemeButton);
renderThemeButton();

// ---------- terminal ----------
let slugs = [];
const terminal = createTerminal({
  out: $("term-out"),
  form: $("term-form"),
  input: $("term-input"),
  hint: $("term-hint"),
  chips: $("chips"),
  bucket: { root: $("bucket"), cells: $("bucket-cells"), count: $("bucket-count") },
  projects: { get: () => slugs, set: (s) => (slugs = s) },
  navigate: (page) => router.go(page),
});

/** Runs a command in the home terminal, switching to the home page first when needed. */
function openInTerminal(command) {
  if (router.page !== "inicio") router.go("inicio", null, "terminal");
  else {
    const top = $("terminal").getBoundingClientRect().top + window.scrollY - 16;
    window.scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  terminal.run(command);
}

/** What an evidence or detail button does. Kept in one place so every page means the same thing by "proj". */
function act(action) {
  if (action.type === "run") openInTerminal(action.target);
  else if (action.type === "proj") router.go("projetos", action.target);
  else if (action.type === "page") router.go(action.target);
  else if (action.type === "live") router.go("inicio", null, "ao-vivo");
  else if (action.type === "exp") router.go("sobre", null, "experiencia");
  else if (action.type === "link") window.open(action.target, "_blank", "noopener");
}

// ---------- hero and projects ----------
// The hero shows these three; phone and the rest live on /contato.
const LINK_LABELS = { github: "GitHub", linkedin: "LinkedIn", email: "E-mail" };

async function renderProfile() {
  const { body } = await api("/api/profile", { auto: true });
  $("hero-name").textContent = body.name;
  $("role").textContent = body.role;
  document.title = `${body.name} · ${body.role}`;
  const links = Object.entries(body.links ?? {})
    .filter(([key, href]) => LINK_LABELS[key] && !href.includes("TODO"))
    .map(([key, href]) =>
      el(
        "a",
        { class: "btn btn-line", href: key === "email" ? `mailto:${href}` : href, target: "_blank", rel: "noopener" },
        LINK_LABELS[key] ?? key,
        icon("external", 14),
      ),
    );
  $("hero-links").append(...links);
}

async function renderProjects() {
  const { body } = await api("/api/projects", { auto: true });
  slugs = body.map((p) => p.slug);
  $("projects").replaceChildren(
    ...body.map((p, i) => {
      const hid = `proj-${p.slug}`;
      const actions = el(
        "div",
        { class: "card-actions" },
        el(
          "button",
          { type: "button", class: "btn btn-line btn-mono", on: { click: () => openInTerminal(`cat ${p.slug}`) } },
          el("span", { class: "accent", attrs: { "aria-hidden": "true" } }, "$"),
          "abrir no terminal",
        ),
      );
      if (p.repo) {
        actions.append(
          el(
            "a",
            {
              class: "repo",
              href: p.repo,
              target: "_blank",
              rel: "noopener",
              attrs: { "aria-label": `repositório do ${p.name} no GitHub` },
            },
            "repo",
            icon("external", 13),
          ),
        );
      }
      return el(
        "article",
        { class: "cell card", attrs: { "aria-labelledby": hid } },
        el(
          "div",
          { class: "card-meta" },
          el("span", {}, String(i + 1).padStart(2, "0")),
          el("span", {}, p.tags.join(" · ")),
        ),
        el("h3", { id: hid }, p.name),
        el("p", {}, p.summary),
        el(
          "ul",
          { class: "stack", attrs: { "aria-label": "Stack" } },
          p.stack.map((s) => el("li", {}, s)),
        ),
        actions,
      );
    }),
  );
}

// ---------- my requests ----------
createRequestsPanel({
  button: $("my-requests-btn"),
  count: $("my-requests-count"),
  panel: $("my-requests"),
  list: $("my-requests-list"),
  close: $("my-requests-close"),
  showAuto: $("my-requests-auto"),
  tabs: [
    { tab: $("req-tab-list"), view: $("req-view-list") },
    { tab: $("req-tab-arch"), view: $("req-view-arch") },
  ],
});

// ---------- live panel and diagram ----------
const diagram = createDiagram({
  wide: $("diagram-wide"),
  narrow: $("diagram-narrow"),
  extra: [$("my-requests-diagram")],
  log: $("request-log"),
});
createLivePanel({
  facts: $("facts"),
  stats: $("stats"),
  routes: document.querySelector("#routes tbody"),
  lastRead: $("last-read"),
  footer: { build: $("build"), rest: $("build-rest") },
  onStatus: (status) => diagram.setLlm(status.llm),
});

// ---------- pages ----------
const go = (page, param) => router.go(page, param);
const router = createRouter({
  nav: $("pages-nav"),
  pages: {
    inicio: { root: $("page-inicio") },
    sobre: createSobrePage({ root: $("page-sobre"), act }),
    projetos: createProjetosPage({ root: $("page-projetos"), act, go }),
    mcp: createMcpPage({ root: $("page-mcp") }),
    contato: createContatoPage({ root: $("page-contato") }),
    voce: createVocePage({ root: $("page-voce") }),
  },
});

renderProfile().catch(() => {});
renderProjects().catch(() => {});
