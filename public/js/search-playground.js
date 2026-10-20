import { api } from "./api.js";
import { el } from "./dom.js";
import { explainTerm, formatMs, rankShift, scoreBar } from "./lib.js";

const DEBOUNCE_MS = 120; // a slider drag becomes a few searches, not one per pixel

const SLIDERS = [
  { name: "k1", label: "k1", step: 0.1, hint: "saturação: quanto repetir o termo ainda soma" },
  { name: "b", label: "b", step: 0.05, hint: "normalização: quanto um trecho longo é penalizado" },
  { name: "k", label: "top-k", step: 1, hint: "quantos trechos voltam" },
];

/**
 * The live search playground inside the terminal: three sliders over the chat's own BM25 index.
 * Every change asks the server again; only the latest answer is drawn, so a fast drag never
 * paints an older ranking over a newer one. `freeze()` turns it off when another one opens.
 * `cite(source)` builds the link that opens a hit's section.
 */
export function createSearchPlayground({ query, limits, defaults, cite }) {
  const params = { ...defaults };
  let seq = 0;
  let timer = null;
  let previous = new Map(); // id → rank in the last drawing, to flag what just moved

  const status = el("div", { class: "t-line t-dim", attrs: { "aria-live": "polite" } });
  const list = el("ol", { class: "t-rank" });
  const inputs = SLIDERS.map(({ name, label, step, hint }) => {
    const value = el("output", { class: "t-acc" }, format(name, params[name]));
    const input = el("input", {
      type: "range",
      min: limits[name].min,
      max: limits[name].max,
      step,
      value: params[name],
      title: hint,
      attrs: { "aria-label": `${label}: ${hint}` },
      on: {
        input: () => {
          params[name] = Number(input.value);
          value.textContent = format(name, params[name]);
          schedule();
        },
      },
    });
    return { name, input, value, field: el("label", { class: "t-slider" }, el("span", {}, label), input, value) };
  });
  const reset = el(
    "button",
    {
      type: "button",
      class: "t-btn",
      on: {
        click: () => {
          for (const { name, input, value } of inputs) {
            params[name] = defaults[name];
            input.value = defaults[name];
            value.textContent = format(name, defaults[name]);
          }
          schedule();
        },
      },
    },
    "padrão do servidor",
  );
  const root = el(
    "div",
    { class: "t-play" },
    el(
      "div",
      { class: "t-sliders" },
      inputs.map((i) => i.field),
      reset,
    ),
    status,
    list,
  );

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, DEBOUNCE_MS);
  }

  async function update() {
    const mine = ++seq;
    const qs = new URLSearchParams({ q: query, k1: params.k1, b: params.b, k: params.k });
    let res, body, ms;
    try {
      ({ res, body, ms } = await api(`/api/lab/search?${qs}`));
    } catch {
      if (mine === seq) status.textContent = "sem resposta da API; mexa de novo num slider para tentar";
      return;
    }
    if (mine !== seq) return; // a newer search is on its way
    if (!res.ok) {
      status.textContent = body?.error ?? `erro ${res.status}`;
      status.className = "t-line t-warn";
      return;
    }
    status.className = "t-line t-dim";
    draw(body, ms);
  }

  function draw(body, ms) {
    const best = body.hits[0]?.score ?? 0;
    const terms = body.terms.length ? body.terms.join(" ") : "nenhum (só stopwords)";
    status.textContent =
      `termos: ${terms} · ${body.index.chunks} trechos, média de ${body.index.averageLength} termos` +
      ` · ${formatMs(ms)} ida e volta`;
    if (!body.hits.length) {
      list.replaceChildren(el("li", { class: "t-dim" }, "nenhum trecho tem esses termos"));
      previous = new Map();
      return;
    }
    list.replaceChildren(
      ...body.hits.map((hit) => {
        const moved = previous.has(hit.id) && previous.get(hit.id) !== hit.rank;
        const shift = rankShift(hit.rank, hit.defaultRank);
        return el(
          "li",
          { class: moved ? "t-hit t-moved" : "t-hit" },
          el(
            "div",
            { class: "t-line" },
            text(`#${hit.rank} `),
            el(
              "span",
              { class: shift === "=" ? "t-dim" : "t-acc", title: "posição com os parâmetros padrão do servidor" },
              shift.padEnd(5),
            ),
            el("span", { class: "t-acc" }, scoreBar(hit.score, best)),
            text(` ${hit.score.toFixed(3)}  `),
            cite(hit.source),
          ),
          el("div", { class: "t-line t-dim" }, `${hit.terms.map(explainTerm).join("  +  ")}  · ${hit.length} termos`),
          el("div", { class: "t-line t-dim t-cut" }, hit.preview),
        );
      }),
    );
    previous = new Map(body.hits.map((h) => [h.id, h.rank]));
  }

  function freeze() {
    clearTimeout(timer);
    seq++;
    for (const { input } of inputs) input.disabled = true;
    reset.disabled = true;
    root.classList.add("t-frozen");
  }

  return { root, update, freeze };
}

const text = (t) => el("span", {}, t);
const format = (name, value) => (name === "k" ? String(value) : Number(value).toFixed(2));
