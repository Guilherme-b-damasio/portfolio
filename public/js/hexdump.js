import { el } from "./dom.js";
import { fieldOfByte, ja4Parts } from "./lib.js";

const narrow = matchMedia("(max-width: 559px)");

/**
 * Draws a ClientHello as a hex dump where every byte belongs to a labelled field. Picking a field
 * (from the legend, or by hovering or tapping a byte) lights up all of its bytes and names it.
 */
export function createHexDump(root) {
  let view = null;
  let spansByField = [];
  let selected = -1;

  const caption = el("p", { class: "hex-caption mono small", attrs: { "aria-live": "polite" } });
  const legend = el("div", { class: "hex-legend", attrs: { role: "group", "aria-label": "Campos do handshake" } });
  const dump = el("div", { class: "hex-dump", attrs: { role: "img" } });
  const ja4 = el("div", { class: "ja4" });
  root.replaceChildren(ja4, dump, caption, legend);

  function select(i) {
    if (i === selected) return;
    for (const span of spansByField[selected] ?? []) span.classList.remove("on");
    for (const button of legend.children) button.setAttribute("aria-pressed", "false");
    selected = i;
    const field = view?.fields[i];
    if (!field) {
      caption.textContent = "Passe o mouse ou toque num byte, ou escolha um campo abaixo.";
      return;
    }
    for (const span of spansByField[i]) span.classList.add("on");
    legend.children[i]?.setAttribute("aria-pressed", "true");
    caption.textContent = `${field.label} · ${field.length} bytes · posição ${field.offset}`;
  }

  function render() {
    if (!view) return;
    const perRow = narrow.matches ? 8 : 16;
    const owner = fieldOfByte(view.hex.length / 2, view.fields);
    spansByField = view.fields.map(() => []);
    selected = -1;

    ja4.replaceChildren(
      el("p", { class: "muted small" }, `JA4 · ${view.stack}`),
      el(
        "p",
        { class: "ja4-code" },
        ja4Parts(view.ja4).map((p) => el("span", { attrs: { title: p.meaning } }, p.text)),
      ),
      el(
        "dl",
        { class: "ja4-legend" },
        ja4Parts(view.ja4).map((p) => el("div", {}, el("dt", { class: "mono" }, p.text), el("dd", {}, p.meaning))),
      ),
    );

    const rows = [];
    let extensionCount = 0;
    const alt = view.fields.map((f) => (f.kind === "extension" ? extensionCount++ % 2 : 0));
    for (let start = 0; start < owner.length; start += perRow) {
      const bytes = [];
      for (let b = start; b < Math.min(owner.length, start + perRow); b++) {
        const i = owner[b];
        const span = el(
          "span",
          {
            class: `hb k-${view.fields[i]?.kind ?? "none"}${alt[i] ? " alt" : ""}`,
            on: { pointerenter: () => select(i) },
          },
          view.hex.slice(b * 2, b * 2 + 2),
        );
        if (i >= 0) spansByField[i].push(span);
        bytes.push(span);
      }
      rows.push(
        el("div", { class: "hex-row" }, el("span", { class: "hex-off" }, start.toString(16).padStart(4, "0")), bytes),
      );
    }
    dump.replaceChildren(...rows);
    dump.setAttribute(
      "aria-label",
      `ClientHello de ${view.bytes} bytes em hexadecimal; os campos estão listados logo abaixo.`,
    );

    legend.replaceChildren(
      ...view.fields.map((f, i) =>
        el(
          "button",
          {
            type: "button",
            class: `hex-field k-${f.kind}${alt[i] ? " alt" : ""}`,
            attrs: { "aria-pressed": "false" },
            on: { click: () => select(i), focus: () => select(i) },
          },
          f.label,
        ),
      ),
    );
    select(-1);
    caption.textContent = "Passe o mouse ou toque num byte, ou escolha um campo abaixo.";
  }

  narrow.addEventListener("change", render);

  return {
    show(next) {
      view = next;
      render();
    },
  };
}
