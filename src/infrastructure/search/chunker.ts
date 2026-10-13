import type { Content } from "../../domain/content.js";
import type { Chunk } from "../../domain/search.js";

/** Splits every markdown document on its "## " headings so a chunk never mixes two sections. */
export function chunkContent(content: Content): Chunk[] {
  const docs = [
    { file: "profile.md", header: `${content.profile.name} — ${content.profile.role}`, body: content.profile.body },
    ...content.projects.map((p) => ({
      file: `${p.slug}.md`,
      header: `${p.name}: ${p.summary} Stack: ${p.stack.join(", ")}`,
      body: p.body,
    })),
  ];

  const chunks: Chunk[] = [];
  for (const doc of docs) {
    chunks.push({ id: `${doc.file}#0`, source: doc.file, text: doc.header });
    const sections = doc.body.split(/^## /m).filter((s) => s.trim());
    sections.forEach((section, i) => {
      const [title, ...rest] = section.split("\n");
      const text = rest.join("\n").trim();
      // Sections still marked TODO are placeholders; indexing them would only add noise.
      if (text && !/^TODO\b/.test(text)) chunks.push({ id: `${doc.file}#${i + 1}`, source: `${doc.file} › ${title.trim()}`, text });
    });
  }
  return chunks;
}
