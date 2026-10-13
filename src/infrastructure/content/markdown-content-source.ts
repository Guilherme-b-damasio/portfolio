import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";
import type { Content, ContentSource, Profile, Project, SkillGroup } from "../../domain/content.js";

const action = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["exp", "live"]), label: z.string() }),
  z.object({ type: z.enum(["proj", "run", "page", "link"]), target: z.string(), label: z.string() }),
]);
const skillsFile = z.object({
  groups: z.array(
    z.object({
      title: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          evidence: z.array(z.object({ where: z.string(), text: z.string(), action })).min(1),
        }),
      ),
    }),
  ),
});

/** Reads `profile.md` and `projects/*.md` (front matter + body) from a directory. */
export class MarkdownContentSource implements ContentSource {
  constructor(private readonly dir: string) {}

  async load(): Promise<Content> {
    const profileFile = matter(await readFile(path.join(this.dir, "profile.md"), "utf8"));
    const profile = { ...(profileFile.data as Omit<Profile, "body">), body: profileFile.content.trim() };

    const projectsDir = path.join(this.dir, "projects");
    const files = (await readdir(projectsDir)).filter((f) => f.endsWith(".md"));
    const projects = await Promise.all(
      files.map(async (file) => {
        const { data, content } = matter(await readFile(path.join(projectsDir, file), "utf8"));
        return {
          slug: data.slug ?? path.basename(file, ".md"),
          name: data.name ?? data.slug,
          summary: data.summary ?? "",
          stack: data.stack ?? [],
          tags: data.tags ?? [],
          repo: data.repo,
          order: data.order ?? 99,
          body: content.trim(),
        } satisfies Project;
      }),
    );
    projects.sort((a, b) => a.order - b.order);

    return { profile, projects, skills: await this.loadSkills() };
  }

  /** skills.md is front matter only. It is optional, but a malformed file fails loudly at boot. */
  private async loadSkills(): Promise<SkillGroup[]> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.dir, "skills.md"), "utf8");
    } catch {
      return [];
    }
    const parsed = skillsFile.safeParse(matter(raw).data);
    if (!parsed.success) throw new Error(`content/skills.md inválido: ${parsed.error.message}`);
    return parsed.data.groups;
  }
}
