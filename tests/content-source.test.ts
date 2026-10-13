import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MarkdownContentSource } from "../src/infrastructure/content/markdown-content-source.js";

async function contentDir(skills?: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "portfolio-content-"));
  await mkdir(path.join(dir, "projects"));
  await writeFile(path.join(dir, "profile.md"), "---\nname: N\nhandle: n\nrole: r\nlinks: {}\n---\n## Sobre\ntexto");
  if (skills !== undefined) await writeFile(path.join(dir, "skills.md"), skills);
  return dir;
}

describe("MarkdownContentSource skills", () => {
  it("treats a missing skills.md as no skills", async () => {
    const content = await new MarkdownContentSource(await contentDir()).load();
    expect(content.skills).toEqual([]);
  });

  it("loads skill groups from the front matter", async () => {
    const yaml = [
      "---",
      "groups:",
      "  - title: IA",
      "    items:",
      "      - name: RAG",
      "        evidence:",
      "          - { where: docsage, text: t, action: { type: proj, target: docsage, label: abrir } }",
      "---",
    ].join("\n");
    const content = await new MarkdownContentSource(await contentDir(yaml)).load();
    expect(content.skills[0].items[0].evidence[0].action).toEqual({ type: "proj", target: "docsage", label: "abrir" });
  });

  it("refuses a skill without evidence, so the page never shows a claim with no proof", async () => {
    const yaml = "---\ngroups:\n  - title: IA\n    items:\n      - { name: RAG, evidence: [] }\n---";
    await expect(new MarkdownContentSource(await contentDir(yaml)).load()).rejects.toThrow(/skills\.md/);
  });
});
