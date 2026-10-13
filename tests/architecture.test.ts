import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Guards the dependency rule from CONTRIBUTING.md: imports only point inward.
const src = path.resolve(import.meta.dirname, "..", "src");
const allowed: Record<string, string[]> = {
  domain: ["domain"],
  application: ["domain", "application"],
  infrastructure: ["domain", "infrastructure"],
  http: ["domain", "application", "http"],
};

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : [],
  );
}

function layerOf(file: string): string | undefined {
  return path.relative(src, file).split(path.sep)[0];
}

describe("architecture", () => {
  for (const [layer, targets] of Object.entries(allowed)) {
    it(`${layer}/ only imports from ${targets.join(", ")}`, () => {
      const violations: string[] = [];
      for (const file of filesIn(path.join(src, layer))) {
        for (const [, spec] of readFileSync(file, "utf8").matchAll(/from\s+"(\.[^"]+)"/g)) {
          const target = layerOf(path.resolve(path.dirname(file), spec));
          if (!target || !targets.includes(target)) violations.push(`${path.relative(src, file)} -> ${spec}`);
        }
      }
      expect(violations).toEqual([]);
    });
  }
});
