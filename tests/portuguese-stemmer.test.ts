import { describe, expect, it } from "vitest";
import { stemPortuguese } from "../src/infrastructure/search/portuguese-stemmer.js";

describe("stemPortuguese", () => {
  it("brings verb and noun forms of a word to the same stem", () => {
    const stems = ["trabalha", "trabalho", "trabalhar", "trabalhou", "trabalhando"].map(stemPortuguese);
    expect(new Set(stems)).toEqual(new Set(["trabalh"]));
    expect(stemPortuguese("programacao")).toBe(stemPortuguese("programar"));
    expect(stemPortuguese("integracao")).toBe(stemPortuguese("integrar"));
  });

  it("folds plurals onto the singular", () => {
    expect(stemPortuguese("times")).toBe(stemPortuguese("time"));
    expect(stemPortuguese("decisoes")).toBe(stemPortuguese("decisao"));
    expect(stemPortuguese("linguagens")).toBe(stemPortuguese("linguagem"));
    expect(stemPortuguese("digitais")).toBe("digital");
    expect(stemPortuguese("bancos")).toBe(stemPortuguese("banco"));
  });

  it("leaves short words, names and tokens with symbols alone", () => {
    for (const token of ["usa", "aws", "sqs", "redis", "status", "express", "node.js", "c#", "s3", "bm25"])
      expect(stemPortuguese(token)).toBe(token);
  });

  it("never cuts a stem shorter than three letters", () => {
    expect(stemPortuguese("usar")).toBe("usar");
    expect(stemPortuguese("lei")).toBe("lei");
  });
});
