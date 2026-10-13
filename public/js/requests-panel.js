import { requests } from "./api.js";
import { el } from "./dom.js";
import { clock, formatMs } from "./lib.js";

const MAX_ENTRIES = 100; // the panel is a window, not a history: older entries fall off

/** Floating list of the requests this browser made during the visit, opened from the top bar. */
export function createRequestsPanel({ button, count, panel, list, close, showAuto }) {
  const entries = [];

  const visible = () => entries.filter((r) => showAuto.checked || !r.auto);

  function render() {
    const rows = visible();
    count.textContent = String(rows.length);
    if (panel.hidden) return;
    if (!rows.length) {
      list.replaceChildren(el("li", { class: "req-empty" }, "Nada ainda. Rode um comando no terminal."));
      return;
    }
    list.replaceChildren(
      ...rows.map((r) => {
        const ok = r.status >= 200 && r.status < 400;
        return el(
          "li",
          { class: ok ? (r.auto ? "auto" : "") : "bad" },
          el("span", { class: "muted" }, clock(r.at)),
          el("span", { class: "req-path", title: `${r.method} ${r.path}` }, el("b", {}, r.method), ` ${r.path}`),
          el("span", {}, r.status ? String(r.status) : "falhou"),
          el("span", { class: "muted" }, formatMs(r.ms)),
        );
      }),
    );
  }

  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    render();
    (open ? close : button).focus();
  }

  requests.addEventListener("request", ({ detail }) => {
    entries.unshift(detail);
    if (entries.length > MAX_ENTRIES) entries.pop();
    render();
  });
  button.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
  showAuto.addEventListener("change", render);
  render();
}
