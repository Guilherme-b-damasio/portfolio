import type { Content, Profile, Project, ProjectSummary, SkillGroup } from "../domain/content.js";

/** Read side of the portfolio: the profile and the project list, with an optional tag filter. */
export class BrowsePortfolio {
  constructor(private readonly content: Content) {}

  profile(): Profile {
    return this.content.profile;
  }

  projects(tag?: string): ProjectSummary[] {
    return this.content.projects
      .filter((p) => !tag || p.tags.includes(tag))
      .map(({ body: _body, ...summary }) => summary);
  }

  skills(): SkillGroup[] {
    return this.content.skills;
  }

  project(slug: string): Project | undefined {
    return this.content.projects.find((p) => p.slug === slug);
  }
}
