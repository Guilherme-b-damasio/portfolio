import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import { type Hit, type Retriever, RetrieverUnavailable } from "../../domain/search.js";

// What docsage's `search_documents` tool returns as structured content (docsage/interfaces/serializers.py).
const searchOutput = z.object({
  results: z.array(
    z.object({
      score: z.number(),
      matched_terms: z.array(z.string()),
      chunk: z.object({ id: z.string(), source: z.string(), section: z.string().nullish(), text: z.string() }),
    }),
  ),
});

export interface DocsageOptions {
  timeoutMs?: number; // one search, connection included; past it the caller falls back to the local index
}

/**
 * Searches a docsage index through its MCP server (`search_documents`, BM25 over the same content).
 * One connection is kept and reopened after any failure, so a restarted docsage is picked up again.
 */
export class DocsageRetriever implements Retriever {
  private client: Promise<Client> | null = null;
  private readonly timeoutMs: number;

  constructor(
    private readonly connect: () => Promise<Client>,
    { timeoutMs = 2_000 }: DocsageOptions = {},
  ) {
    this.timeoutMs = timeoutMs;
  }

  async search(query: string, k = 4): Promise<Hit[]> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      const client = await abortable((this.client ??= this.connect()), signal);
      const result = await client.callTool({ name: "search_documents", arguments: { query, top_k: k } }, undefined, {
        signal,
        timeout: this.timeoutMs,
      });
      if (result.isError) throw new RetrieverUnavailable("docsage recusou a busca");
      const parsed = searchOutput.safeParse(result.structuredContent);
      if (!parsed.success) throw new RetrieverUnavailable("docsage respondeu num formato que não reconheço");
      const { results } = parsed.data;
      return results.map(({ score, matched_terms, chunk }) => ({
        chunk: { id: `docsage:${chunk.id}`, source: citation(chunk.source, chunk.section), text: chunk.text },
        score: Number(score.toFixed(3)),
        matchedTerms: matched_terms,
      }));
    } catch (err) {
      this.reset();
      if (signal.aborted) throw new RetrieverUnavailable(`docsage não respondeu em ${this.timeoutMs} ms`);
      throw err instanceof RetrieverUnavailable
        ? err
        : new RetrieverUnavailable("docsage está fora do ar", { cause: err });
    }
  }

  private reset(): void {
    const stale = this.client;
    this.client = null;
    stale?.then((c) => c.close()).catch(() => {});
  }
}

/** Same shape as the local index ("docsage.md › Decisões técnicas"), so citations still open the project. */
export function citation(source: string, section?: string | null): string {
  const file = source.split(/[\\/]/).pop() ?? source;
  return section ? `${file} › ${section}` : file;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    promise.then(resolve, reject);
  });
}
