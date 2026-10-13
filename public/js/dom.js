// Tiny DOM helpers. API data only ever reaches the page as text nodes, never as markup.

export function el(tag, props = {}, ...children) {
  const { class: className, attrs, on, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  for (const [k, fn] of Object.entries(on ?? {})) node.addEventListener(k, fn);
  append(node, children);
  return node;
}

/** Renders markdownBlocks() output with text nodes: paragraphs, bullets, sub-headings and TODO notes. */
export function renderBlocks(blocks, { headingTag = "h4" } = {}) {
  const inline = (parts) => parts.map((p) => (p.bold ? el("strong", {}, p.text) : p.text));
  return blocks.map((b) => {
    if (b.type === "h3") return el(headingTag, { class: "md-h" }, b.text);
    if (b.type === "li")
      return el(
        "div",
        { class: "md-li" },
        el("span", { attrs: { "aria-hidden": "true" } }, "–"),
        el("span", {}, inline(b.parts)),
      );
    if (b.type === "todo") return el("p", { class: "md-todo" }, b.text);
    return el("p", { class: "md-p" }, inline(b.parts));
  });
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
}

const ICONS = {
  arrowDown: "M12 5v14M19 12l-7 7-7-7",
  external: "M7 17 17 7M7 7h10v10",
  moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",
  sun: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
};

/** A stroked 24×24 icon; decorative, so hidden from screen readers. */
export function icon(name, size = 16) {
  const s = svg("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  });
  if (name === "sun") s.append(svg("circle", { cx: 12, cy: 12, r: 4 }));
  s.append(svg("path", { d: ICONS[name] }));
  return s;
}

/** Copies text and says so on the button for a moment. */
export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "copiado ✓";
  } catch {
    button.textContent = "selecione e copie";
  }
  setTimeout(() => (button.textContent = "copiar"), 1600);
}
