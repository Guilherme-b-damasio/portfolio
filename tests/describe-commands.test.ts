import { describe, expect, it } from "vitest";
import { DescribeCommands } from "../src/application/describe-commands.js";
import type { Capability, ManualLibrary, ManualPage } from "../src/domain/manual.js";
import { StaticManualLibrary } from "../src/infrastructure/manual/static-manual-library.js";
import { WiredCapabilities } from "../src/infrastructure/manual/wired-capabilities.js";

const page = (name: string, needs?: Capability): ManualPage => ({
  name,
  summary: `o ${name}`,
  synopsis: [name],
  description: `o que o ${name} faz`,
  ...(needs && { needs: { capability: needs, text: `${needs} não está ligado aqui` } }),
});

const library = (...pages: ManualPage[]): ManualLibrary => ({
  pages: () => pages,
  page: (name) => pages.find((p) => p.name === name),
});

describe("DescribeCommands", () => {
  it("lists every page, marking the ones this server cannot answer", () => {
    const man = new DescribeCommands(
      library(page("help"), page("stun", "stun"), page("ask", "llm")),
      new WiredCapabilities({ llm: true }),
    );
    expect(man.list().commands).toEqual([
      { name: "help", summary: "o help", available: true },
      { name: "stun", summary: "o stun", available: false },
      { name: "ask", summary: "o ask", available: true },
    ]);
  });

  it("carries the reason a command is off here, and nothing when it is on", () => {
    const man = new DescribeCommands(library(page("stun", "stun"), page("help")), new WiredCapabilities({}));
    expect(man.page("stun")).toMatchObject({ available: false, off: "stun não está ligado aqui" });
    expect(man.page("help")).toMatchObject({ available: true, off: null });
  });

  it("has no page for a command it does not know", () => {
    const man = new DescribeCommands(library(page("help")), new WiredCapabilities({}));
    expect(man.page("rm")).toBeNull();
  });

  it("reads the shipped manual case-insensitively, with a page for every command", () => {
    const man = new DescribeCommands(new StaticManualLibrary(), new WiredCapabilities({ cluster: true }));
    const names = man.list().commands.map((c) => c.name);
    for (const command of ["help", "man", "ask", "kubectl", "scan", "curl", "clear"]) {
      expect(names).toContain(command);
    }
    expect(man.page("KUBECTL")).toMatchObject({ name: "kubectl", available: true });
    // The whole manual is one screen of names: every page has a synopsis and says something.
    for (const command of names) {
      const found = man.page(command)!;
      expect(found.synopsis.length).toBeGreaterThan(0);
      expect(found.description.length).toBeGreaterThan(40);
    }
  });
});
