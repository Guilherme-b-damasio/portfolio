import { describe, expect, it } from "vitest";
import type { Trait } from "../src/domain/anonymity.js";
import { InMemoryCrowd, OVERFLOW } from "../src/infrastructure/anonymity/in-memory-crowd.js";

const gpu = (value: string): Trait => ({ attribute: "gpu", label: "GPU", value });
const tz = (value: string): Trait => ({ attribute: "fuso", label: "fuso", value });

describe("InMemoryCrowd", () => {
  it("counts how many share each value, per attribute", () => {
    const crowd = new InMemoryCrowd({ now: () => new Date(Date.UTC(2026, 9, 22, 12)) });
    crowd.record([gpu("Adreno 730"), tz("America/Sao_Paulo")]);
    crowd.record([gpu("Adreno 730"), tz("America/Sao_Paulo")]);
    crowd.record([gpu("RTX 3060"), tz("America/Sao_Paulo")]);

    expect(crowd.counted).toBe(3);
    expect(crowd.since).toBe("2026-10-22T12:00:00.000Z");
    expect(crowd.rarity([gpu("RTX 3060"), tz("America/Sao_Paulo")])).toEqual([
      { attribute: "gpu", label: "GPU", value: "RTX 3060", matching: 1, total: 3, oneIn: 3, capped: false },
      {
        attribute: "fuso",
        label: "fuso",
        value: "America/Sao_Paulo",
        matching: 3,
        total: 3,
        oneIn: 1,
        capped: false,
      },
    ]);
  });

  it("puts the rarest trait first", () => {
    const crowd = new InMemoryCrowd();
    for (let i = 0; i < 10; i += 1) crowd.record([gpu("Mali-G78"), tz(i === 0 ? "Asia/Tokyo" : "Europe/Lisbon")]);
    expect(crowd.rarity([gpu("Mali-G78"), tz("Asia/Tokyo")]).map((r) => r.attribute)).toEqual(["fuso", "gpu"]);
  });

  it("leaves out a trait nobody has shown", () => {
    const crowd = new InMemoryCrowd();
    crowd.record([gpu("Adreno 730")]);
    expect(crowd.rarity([gpu("RTX 3060"), tz("Pacific/Auckland")])).toEqual([]);
  });

  it("counts nothing for a visitor without a single trait", () => {
    const crowd = new InMemoryCrowd();
    crowd.record([]);
    expect(crowd.counted).toBe(0);
  });

  it("keeps a flood of new values in one overflow bucket", () => {
    const crowd = new InMemoryCrowd({ maxValues: 2 });
    crowd.record([gpu("a")]);
    crowd.record([gpu("b")]);
    crowd.record([gpu("c")]);
    crowd.record([gpu("d")]);

    expect(crowd.rarity([gpu("a")])[0]).toMatchObject({ matching: 1, total: 4, capped: false });
    // "c" and "d" were counted together, so their count is a ceiling, not their own.
    expect(crowd.rarity([gpu("c")])[0]).toMatchObject({ value: "c", matching: 2, total: 4, oneIn: 2, capped: true });
    expect(crowd.rarity([gpu(OVERFLOW)])[0]).toMatchObject({ matching: 2, capped: false });
  });

  it("cuts a value that is too long to keep", () => {
    const crowd = new InMemoryCrowd({ maxValueLength: 10 });
    crowd.record([gpu("ANGLE (NVIDIA GeForce RTX 3060)")]);
    expect(crowd.rarity([gpu("ANGLE (NVIDIA GeForce RTX 3060)")])[0]).toMatchObject({
      value: "ANGLE (NV…",
      matching: 1,
    });
  });
});
