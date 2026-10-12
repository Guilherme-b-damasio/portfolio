import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

export interface Profile {
  name: string;
  handle: string;
  role: string;
  location?: string;
  links: Record<string, string>;
  body: string;
}

export interface Project {
  slug: string;
  name: string;
  summary: string;
  stack: string[];
  tags: string[];
  repo?: string;
  order: number;
  body: string;
}

export interface Content {
  profile: Profile;
  projects: Project[];
}

export async function loadContent(dir: string): Promise<Content> {
  const profileFile = matter(await readFile(path.join(dir, "profile.md"), "utf8"));
  const profile = { ...(profileFile.data as Omit<Profile, "body">), body: profileFile.content.trim() };

  const projectsDir = path.join(dir, "projects");
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
