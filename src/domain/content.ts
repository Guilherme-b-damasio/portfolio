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

/** Where an action on a piece of evidence takes the visitor. */
export type EvidenceAction =
  | { type: "exp"; label: string }
  | { type: "live"; label: string }
  | { type: "proj" | "run" | "page" | "link"; target: string; label: string };

export interface Evidence {
  where: string; // "RotaExata", "docsage", "este site"
  text: string;
  action: EvidenceAction;
}

export interface Skill {
  name: string;
  evidence: Evidence[];
}

export interface SkillGroup {
  title: string;
  items: Skill[];
}

export interface Content {
  profile: Profile;
  projects: Project[];
  skills: SkillGroup[];
}

/** Where the site's Markdown comes from. The filesystem loader is the only adapter today. */
export interface ContentSource {
  load(): Promise<Content>;
}
