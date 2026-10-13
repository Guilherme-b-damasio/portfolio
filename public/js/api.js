import { routeLabel } from "./lib.js";

/** Every request the page makes is announced here, so the diagram and the request log show real traffic. */
export const requests = new EventTarget();

export async function api(path, init = {}) {
  const method = init.method ?? "GET";
  const started = performance.now();
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    announce({ route: routeLabel(method, path), status: 0, ms: performance.now() - started });
    throw err;
  }
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await res.json() : await res.text();
  const ms = performance.now() - started;
  announce({ route: routeLabel(method, path), status: res.status, ms, generated: Boolean(body?.model) });
  return { res, body, ms, type };
}

function announce(detail) {
  requests.dispatchEvent(new CustomEvent("request", { detail: { ...detail, at: new Date() } }));
}
