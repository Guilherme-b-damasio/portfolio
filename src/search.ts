import type { Content } from "./content.js";

export interface Chunk {
  id: string;
  source: string; // e.g. "docsage.md › Decisões técnicas"
  text: string;
}

export interface Hit {
  chunk: Chunk;
  score: number;
  matchedTerms: string[];
}

/** Anything that can turn a question into ranked passages. The local BM25 below is the default; docsage can replace it. */
export interface Retriever {
  search(query: string, k?: number): Hit[] | Promise<Hit[]>;
}

const STOPWORDS = new Set(
  (
    "a o as os um uma de do da dos das em no na nos nas por para pra com sem que e ou se " +
    "é são foi ser ter tem como mais mas eu você ele ela isso esse essa este esta qual quais " +
    "the a an of to in on for with and or is are was be it this that what which how do does you"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

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

export class Bm25Retriever implements Retriever {
  private readonly docs: { chunk: Chunk; terms: Map<string, number>; length: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  constructor(chunks: Chunk[], private readonly k1 = 1.5, private readonly b = 0.75) {
    this.docs = chunks.map((chunk) => {
      // Index the source without ".md" so "docsage" matches every section of docsage.md.
      const tokens = tokenize(`${chunk.source.replace(/\.md\b/g, "")} ${chunk.text}`);
      const terms = new Map<string, number>();
      for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
      for (const t of terms.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { chunk, terms, length: tokens.length };
    });
    this.avgLength = this.docs.reduce((sum, d) => sum + d.length, 0) / Math.max(this.docs.length, 1);
  }

  search(query: string, k = 4): Hit[] {
    const queryTerms = [...new Set(tokenize(query))];
    const n = this.docs.length;

    return this.docs
      .map(({ chunk, terms, length }) => {
        let score = 0;
        const matchedTerms: string[] = [];
        for (const term of queryTerms) {
          const tf = terms.get(term);
          if (!tf) continue;
          matchedTerms.push(term);
          const df = this.df.get(term) ?? 0;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          score += idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * (length / this.avgLength))));
        }
        return { chunk, score: Number(score.toFixed(3)), matchedTerms };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
