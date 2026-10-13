import { routeLabel } from "./lib.js";

/** Every request the page makes is announced here, so the diagram and the request log show real traffic. */
export const requests = new EventTarget();

/**
 * fetch() plus timing. `auto: true` marks requests the page makes on its own (polling, first load),
 * as opposed to ones the visitor triggered, so the requests panel can hide them.
 */
export async function api(path, { auto = false, ...init } = {}) {
  const method = init.method ?? "GET";
  const base = { method, path, route: routeLabel(method, path), auto };
  const started = performance.now();
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    announce({ ...base, status: 0, ms: performance.now() - started });
    throw err;
  }
  const type = res.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await res.json() : await res.text();
  const ms = performance.now() - started;
  announce({ ...base, status: res.status, ms, generated: Boolean(body?.model) });
  return { res, body, ms, type };
}

function announce(detail) {
  requests.dispatchEvent(new CustomEvent("request", { detail: { ...detail, at: new Date() } }));
}
