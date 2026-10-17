import { parseSse, routeLabel } from "./lib.js";

/** Every request the page makes is announced here, so the diagram and the request log show real traffic. */
export const requests = new EventTarget();

// The x-trace-id of the last request the visitor triggered, for `trace` without an id.
let lastTrace = null;
export const lastTraceId = () => lastTrace;

/**
 * Collects the x-trace-id of every request the visitor triggers from now on. The returned function
 * stops listening and gives the ids in order, so a terminal command can link to its own traces.
 */
export function recordTraces() {
  const ids = [];
  const listen = ({ detail }) => {
    if (!detail.auto && detail.traceId && !ids.includes(detail.traceId)) ids.push(detail.traceId);
  };
  requests.addEventListener("request", listen);
  return () => {
    requests.removeEventListener("request", listen);
    return ids;
  };
}

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
  announce({
    ...base,
    status: res.status,
    ms,
    generated: Boolean(body?.model),
    traceId: res.headers.get("x-trace-id"),
  });
  return { res, body, ms, type };
}

/**
 * Like api(), but asks for a server-sent event stream and hands each event to `onEvent` as it
 * arrives. Errors the server answers before streaming (400, 429, 503) come back as plain JSON.
 * Resolves with the `done` event's data as `body`, or `{ error }` when the stream broke.
 */
export async function apiStream(path, init, onEvent) {
  const method = init.method ?? "GET";
  const base = { method, path, route: routeLabel(method, path), auto: false };
  const started = performance.now();
  let res;
  try {
    res = await fetch(path, { ...init, headers: { ...init.headers, accept: "text/event-stream" } });
  } catch (err) {
    announce({ ...base, status: 0, ms: performance.now() - started });
    throw err;
  }
  let body = null;
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    body = await res.json().catch(() => ({}));
  } else {
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const parsed = parseSse(buffer + value);
      buffer = parsed.rest;
      for (const { event, data } of parsed.events) {
        if (event === "done") body = data;
        else if (event === "error") body = { error: data.error };
        else onEvent(event, data);
      }
    }
    body ??= { error: "A conexão caiu no meio da resposta." };
  }
  const ms = performance.now() - started;
  announce({
    ...base,
    status: res.status,
    ms,
    generated: Boolean(body?.model),
    traceId: res.headers.get("x-trace-id"),
  });
  return { res, body, ms };
}

function announce(detail) {
  if (!detail.auto && detail.traceId) lastTrace = detail.traceId;
  requests.dispatchEvent(new CustomEvent("request", { detail: { ...detail, at: new Date() } }));
}
