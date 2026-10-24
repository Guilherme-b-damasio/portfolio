import type { Capability, ServerCapabilities } from "../../domain/manual.js";

/**
 * What the composition root actually wired, one flag per capability. Anything missing is off, so a
 * manual page reflects this deployment instead of promising a command that cannot answer here.
 */
export class WiredCapabilities implements ServerCapabilities {
  constructor(private readonly wired: Partial<Record<Capability, boolean>>) {}

  has(capability: Capability): boolean {
    return this.wired[capability] === true;
  }
}
