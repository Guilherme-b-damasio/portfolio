// Plain JS so it can import public/js/api.js as the browser does, without type declarations.
/* global CustomEvent */
import { describe, expect, it } from "vitest";
import { recordTraces, requests } from "../public/js/api.js";

const announce = (detail) => requests.dispatchEvent(new CustomEvent("request", { detail }));

describe("recordTraces", () => {
  it("keeps the trace ids of the visitor's requests in order, once each", () => {
    const stop = recordTraces();
    announce({ auto: false, traceId: "aaaaaaaaaaaaaaaa" });
    announce({ auto: false, traceId: "bbbbbbbbbbbbbbbb" });
    announce({ auto: false, traceId: "aaaaaaaaaaaaaaaa" });
    expect(stop()).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
  });

  it("skips polling and responses without a trace", () => {
    const stop = recordTraces();
    announce({ auto: true, traceId: "cccccccccccccccc" });
    announce({ auto: false, traceId: null });
    expect(stop()).toEqual([]);
  });

  it("stops listening once stopped", () => {
    const stop = recordTraces();
    const ids = stop();
    announce({ auto: false, traceId: "dddddddddddddddd" });
    expect(ids).toEqual([]);
  });
});
