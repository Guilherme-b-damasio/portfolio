// Plain JS so it can import public/js/lib.js as the browser does, without type declarations.
import { describe, expect, it } from "vitest";
import {
  ago,
  citationParts,
  commandForSource,
  edgesFor,
  formatUptime,
  guessCommand,
  highlightParts,
  hourStrip,
  parseLine,
  routeLabel,
  sections,
  sparkPoints,
} from "../public/js/lib.js";

describe("front-end helpers", () => {
  it("formats uptime and relative build time", () => {
    expect(formatUptime(75)).toBe("1m 15s");
    expect(formatUptime(3 * 86400 + 4 * 3600)).toBe("3d 4h");
    const now = Date.parse("2026-10-13T14:00:00Z");
    expect(ago("2026-10-13T12:00:00Z", now)).toBe("há 2h");
    expect(ago(null, now)).toBe("");
  });

  it("groups project routes like the server metrics", () => {
    expect(routeLabel("GET", "/api/projects/docsage")).toBe("GET /api/projects/:slug");
    expect(routeLabel("GET", "/api/projects?tag=ia")).toBe("GET /api/projects");
  });

  it("lights the claude edge only when an answer was generated", () => {
    expect(edgesFor({ route: "POST /api/ask", status: 200, generated: true })).toContain("bc");
    expect(edgesFor({ route: "POST /api/ask", status: 200, generated: false })).not.toContain("bc");
    expect(edgesFor({ route: "POST /api/ask", status: 429 })).toEqual(["vi", "ia", "ar"]);
    expect(edgesFor({ route: "GET /api/status", status: 200 })).toEqual(["vi", "ia", "ax"]);
    expect(edgesFor({ route: "GET /api/projects/:slug", status: 404 })).toEqual(["vi", "ia"]);
  });

  it("draws a sparkline only with two or more points", () => {
    expect(sparkPoints([1])).toBeNull();
    const { line, area } = sparkPoints([0, 10]);
    expect(line).toBe("0.0,28.0 100.0,2.0");
    expect(area).toBe("0,30 0.0,28.0 100.0,2.0 100,30");
  });

  it("marks only the hours that have a sample", () => {
    const now = 100 * 3_600_000;
    const hours = hourStrip([{ t: now - 10 }, { t: now - 3 * 3_600_000 - 5 }], now);
    expect(hours).toHaveLength(24);
    expect(hours[23]).toBe(true);
    expect(hours[20]).toBe(true);
    expect(hours.filter(Boolean)).toHaveLength(2);
  });

  it("splits a body on its headings", () => {
    expect(sections("intro\n## O que é\ntexto\n\n## Infra\nTODO")).toEqual([
      ["O que é", "texto"],
      ["Infra", "TODO"],
    ]);
  });

  it("parses quoted arguments and guesses typos", () => {
    expect(parseLine('cat docsage "Decisões técnicas"')).toEqual(["cat", "docsage", "Decisões técnicas"]);
    expect(guessCommand("stauts", ["help", "status", "clear"])).toBe("status");
    expect(guessCommand("xyz", ["help", "status"])).toBeUndefined();
  });

  it("highlights matched terms ignoring accents", () => {
    expect(highlightParts("Decisões técnicas", ["decisoes"])).toEqual([
      { text: "Decisões", mark: true },
      { text: " técnicas", mark: false },
    ]);
  });

  it("turns citations into commands", () => {
    expect(citationParts("Indexa PDF [docsage.md › O que é].")).toEqual([
      { text: "Indexa PDF " },
      { text: "[docsage.md › O que é]", source: "docsage.md › O que é" },
      { text: "." },
    ]);
    expect(commandForSource("docsage.md › Decisões técnicas")).toBe('cat docsage "Decisões técnicas"');
    expect(commandForSource("docsage.md")).toBe("cat docsage");
    expect(commandForSource("profile.md › Stack")).toBe("whoami");
  });
});
