import { PAGES, parseRoute } from "./lib.js";

/**
 * Hash router: "#/sobre" shows one page, plain anchors ("#ao-vivo") stay on the home page and scroll.
 * Each page's `enter(param)` runs every time it is shown; pages load their data on first entry.
 */
export function createRouter({ pages, nav, onChange }) {
  let current = null;
  let pendingAnchor = null; // an element to scroll to once the page is shown, e.g. #experiencia

  function render() {
    const { page, param, anchor } = parseRoute(location.hash);
    for (const id of PAGES) pages[id].root.hidden = id !== page;
    for (const link of nav.querySelectorAll("a[data-page]")) {
      if (link.dataset.page === page) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    const changed = page !== current;
    current = page;
    pages[page].enter?.(param);
    onChange?.(page);
    const target = anchor ?? pendingAnchor;
    pendingAnchor = null;
    if (target) document.getElementById(target)?.scrollIntoView();
    else if (changed) window.scrollTo(0, 0);
  }

  window.addEventListener("hashchange", render);
  render();

  return {
    go(page, param, anchor) {
      pendingAnchor = anchor ?? null;
      const hash = page === "inicio" && !param ? "#/inicio" : `#/${page}${param ? "/" + param : ""}`;
      if (location.hash === hash) render();
      else location.hash = hash;
    },
    get page() {
      return current;
    },
  };
}
