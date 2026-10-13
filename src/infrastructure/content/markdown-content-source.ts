import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { Content, ContentSource, Profile, Project } from "../../domain/content.js";

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

    return { profile, projects };
  }
}
