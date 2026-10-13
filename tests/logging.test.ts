import { describe, expect, it } from "vitest";
import { JsonLogger } from "../src/infrastructure/logging/json-logger.js";

describe("JsonLogger", () => {
  const lines: string[] = [];
  const logger = new JsonLogger(
    (line) => lines.push(line),
    () => new Date("2026-10-13T12:00:00Z"),
  );

  it("writes one JSON object per event with time, level and msg", () => {
    logger.info("request", { route: "GET /api/profile", status: 200 });
    logger.error("boom");
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { route: "GET /api/profile", status: 200, time: "2026-10-13T12:00:00.000Z", level: "info", msg: "request" },
      { time: "2026-10-13T12:00:00.000Z", level: "error", msg: "boom" },
    ]);
  });

  it("never lets a field overwrite the fixed keys", () => {
    lines.length = 0;
    logger.info("real", { level: "fake", msg: "fake" });
    expect(JSON.parse(lines[0])).toMatchObject({ level: "info", msg: "real" });
  });
});
