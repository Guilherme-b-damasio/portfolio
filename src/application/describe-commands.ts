import type { ManualLibrary, ManualPage, ServerCapabilities } from "../domain/manual.js";

export interface ManualEntry {
  name: string;
  summary: string;
  available: boolean;
}

export interface ManualView extends ManualPage {
  available: boolean;
  /** Why the command cannot answer here, or null when it can. */
  off: string | null;
}

/**
 * What `man` reads. The pages are fixed, but a page is only honest alongside this server: a command
 * whose capability was not wired here is listed as unavailable, with the reason the page carries.
 */
export class DescribeCommands {
  constructor(
    private readonly library: ManualLibrary,
    private readonly capabilities: ServerCapabilities,
  ) {}

  list(): { commands: ManualEntry[] } {
    return {
      commands: this.library.pages().map((page) => ({
        name: page.name,
        summary: page.summary,
        available: this.available(page),
      })),
    };
  }

  page(name: string): ManualView | null {
    const page = this.library.page(name);
    if (!page) return null;
    const available = this.available(page);
    return { ...page, available, off: available ? null : (page.needs?.text ?? null) };
  }

  private available(page: ManualPage): boolean {
    return !page.needs || this.capabilities.has(page.needs.capability);
  }
}
