export interface Profile {
  name: string;
  fullName?: string;
  handle: string;
  role: string;
  title?: string;
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

export type ProjectSummary = Omit<Project, "body">;

export interface Content {
  profile: Profile;
  projects: Project[];
}

/** Where the site's Markdown comes from. The filesystem loader is the only adapter today. */
export interface ContentSource {
  load(): Promise<Content>;
}
