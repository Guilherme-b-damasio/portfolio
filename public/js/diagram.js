import { requests } from "./api.js";
import { el, svg } from "./dom.js";
import { clock, edgesFor, formatMs } from "./lib.js";

// [id, label, sub, centre in the wide layout, centre in the narrow layout]
const NODES = [
  ["V", "visitante", "navegador", [80, 125], [170, 30]],
  ["I", "ingress", "traefik", [250, 125], [170, 110]],
  ["A", "api", "node · ts", [420, 125], [170, 190]],
  ["R", "rate limit", "token bucket", [600, 45], [85, 288]],
  ["B", "bm25", "busca local", [760, 45], [85, 368]],
  ["C", "claude api", "", [920, 45], [85, 448]],
  ["M", "conteúdo", "markdown", [600, 125], [255, 288]],
  ["X", "métricas", "prometheus", [600, 205], [255, 368]],
];
const NODE_EDGES = {
  V: ["vi"],
  I: ["vi", "ia"],
  A: ["ia", "am", "ar", "ax"],
  R: ["ar", "rb"],
  B: ["rb", "bc"],
  C: ["bc"],
  M: ["am"],
  X: ["ax"],
};
const EDGES = {
  wide: {
    vi: "M146 125H184",
    ia: "M316 125H354",
    ar: "M486 125H510V45H534",
    am: "M486 125H534",
    ax: "M486 125H510V205H534",
    rb: "M666 45H694",
    bc: "M826 45H854",
  },
  narrow: {
    vi: "M170 54V86",
    ia: "M170 134V166",
    ar: "M170 214V238H85V264",
    am: "M170 214V238H255V264",
    ax: "M235 190H332V368H322",
    rb: "M85 312V344",
    bc: "M85 392V424",
  },
};

/**
 * The architecture SVG lit by this visitor's own requests, plus the request log.
 * `extra` holds more narrow-layout copies (the floating panel has one); they all light together.
 */
export function createDiagram({ wide, narrow, extra = [], log }) {
  const roots = [wide, narrow, ...extra];
  const layouts = [
    build(wide, "wide", 1000, 250, 132),
    ...[narrow, ...extra].map((root) => build(root, "narrow", 340, 480, 130)),
  ];
  const entries = [];
  let llm = null;
  let unlit;

  function setLlm(model) {
    llm = model;
    for (const layout of layouts) {
      const claude = layout.nodes.C;
      claude.sub.textContent = model ? model.replace(/^claude-/, "") : "desligado";
      claude.group.classList.toggle("off", !model);
      layout.edges.bc.classList.toggle("off", !model);
    }
  }

  function light(edges) {
    for (const layout of layouts) {
      for (const [id, path] of Object.entries(layout.edges)) path.classList.toggle("lit", edges.includes(id));
      for (const [id, node] of Object.entries(layout.nodes)) {
        const on = NODE_EDGES[id].some((e) => edges.includes(e)) && !(id === "C" && !llm);
        node.group.classList.toggle("lit", on);
      }
    }
    clearTimeout(unlit);
    unlit = setTimeout(() => light([]), 1400);
  }

  requests.addEventListener("request", ({ detail }) => {
    const edges = edgesFor(detail);
    light(edges);
    for (const svgNode of roots) {
      svgNode.setAttribute("aria-label", `Diagrama da arquitetura. Última requisição: ${detail.route}`);
    }
    entries.unshift(detail);
    entries.length = Math.min(entries.length, 6);
    log.replaceChildren(
      ...entries.map((r) =>
        el(
          "li",
          { class: r.status >= 200 && r.status < 400 ? "" : "bad" },
          el("span", { class: "muted" }, clock(r.at)),
          el("span", {}, r.status >= 200 && r.status < 400 ? r.route : `${r.route} · ${r.status || "falhou"}`),
          el("span", {}, formatMs(r.ms)),
        ),
      ),
    );
  });

  return { setLlm };
}

function build(root, layout, width, height, nodeWidth) {
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const edges = {};
  const wires = svg("g", { class: "wires" });
  for (const [id, d] of Object.entries(EDGES[layout])) {
    edges[id] = svg("path", { d });
    wires.append(edges[id]);
  }
  root.append(wires);

  const nodes = {};
  const small = layout === "narrow";
  for (const [id, label, sub, h, v] of NODES) {
    const [cx, cy] = small ? v : h;
    const x = cx - nodeWidth / 2;
    const subText = svg("text", { x: x + 12, y: cy + 14, class: "sub", "font-size": small ? 11 : 12 }, sub);
    const group = svg(
      "g",
      { class: "node" },
      svg("rect", { x, y: cy - 24, width: nodeWidth, height: 48 }),
      svg("text", { x: x + 12, y: cy - 3, class: "label", "font-size": small ? 13 : 14 }, label),
      subText,
    );
    nodes[id] = { group, sub: subText };
    root.append(group);
  }
  return { edges, nodes };
}
