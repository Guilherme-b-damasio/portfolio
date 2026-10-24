/**
 * The manual the terminal's `man` reads. A page is plain data; what changes between servers is
 * whether the command can answer at all, which comes from the capability it needs.
 */

/** Something that has to be wired in `main.ts` for a command to do anything. */
export type Capability =
  "llm" | "docsage" | "cluster" | "deploys" | "traces" | "searchLab" | "loadLab" | "dnsLeak" | "stun" | "tls";

export interface ManualOption {
  flag: string;
  text: string;
}

export interface ManualPage {
  name: string;
  summary: string;
  synopsis: string[];
  description: string;
  options?: ManualOption[];
  examples?: string[];
  seeAlso?: string[];
  /** Without this capability the command still runs, but it only answers that it is off here. */
  needs?: { capability: Capability; text: string };
}

/** Where the pages come from. A page per command, in a fixed order. */
export interface ManualLibrary {
  pages(): ManualPage[];
  page(name: string): ManualPage | undefined;
}

/** What this particular server has wired. */
export interface ServerCapabilities {
  has(capability: Capability): boolean;
}
