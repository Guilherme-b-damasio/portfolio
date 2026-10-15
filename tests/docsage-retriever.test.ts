import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RetrieverUnavailable } from "../src/domain/search.js";
import { citation, DocsageRetriever } from "../src/infrastructure/search/docsage-retriever.js";

// A stand-in for docsage's MCP server: same tool name, arguments and structured output.
function fakeDocsage(respond: (query: string, topK: number) => unknown | Promise<unknown>) {
  const calls: { query: string; top_k: number }[] = [];
  let connections = 0;
  const connect = async () => {
    connections++;
    const server = new McpServer({ name: "docsage", version: "test" });
    server.registerTool(
      "search_documents",
      { inputSchema: { query: z.string(), top_k: z.number() } },
      async ({ query, top_k }) => {
        calls.push({ query, top_k });
        const structuredContent = (await respond(query, top_k)) as Record<string, unknown>;
        return { content: [{ type: "text", text: "..." }], structuredContent };
      },
    );
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "portfolio", version: "test" });
    await client.connect(clientSide);
    return client;
  };
  return { connect, calls, connections: () => connections };
}

const result = (source: string, section: string, score: number) => ({
  rank: 1,
  score,
  matched_terms: ["docsage"],
  highlights: [],
  contributions: [],
  chunk: { id: `${source}:3`, source, position: 3, section, citation: "", text: "um RAG em Python" },
});

describe("DocsageRetriever", () => {
  it("calls search_documents and maps the results to hits shaped like the local index", async () => {
    const docsage = fakeDocsage(() => ({
      query: "q",
      results: [result("/data/content/projects/docsage.md", "Decisões técnicas", 2.34567)],
    }));
    const hits = await new DocsageRetriever(docsage.connect).search("o que é o docsage", 3);

    expect(docsage.calls).toEqual([{ query: "o que é o docsage", top_k: 3 }]);
    expect(hits).toEqual([
      {
        chunk: {
          id: "docsage:/data/content/projects/docsage.md:3",
          source: "docsage.md › Decisões técnicas",
          text: "um RAG em Python",
        },
        score: 2.346,
        matchedTerms: ["docsage"],
      },
    ]);
  });

  it("keeps one connection across searches", async () => {
    const docsage = fakeDocsage(() => ({ query: "q", results: [] }));
    const retriever = new DocsageRetriever(docsage.connect);
    await retriever.search("a");
    await retriever.search("b");
    expect(docsage.connections()).toBe(1);
  });

  it("rejects output it does not recognise and reconnects on the next search", async () => {
    let broken = true;
    const docsage = fakeDocsage(() => (broken ? { nope: true } : { query: "q", results: [] }));
    const retriever = new DocsageRetriever(docsage.connect);

    await expect(retriever.search("a")).rejects.toThrow("formato que não reconheço");
    broken = false;
    await expect(retriever.search("a")).resolves.toEqual([]);
    expect(docsage.connections()).toBe(2);
  });

  it("gives up past the timeout", async () => {
    const docsage = fakeDocsage(() => new Promise(() => {}));
    const retriever = new DocsageRetriever(docsage.connect, { timeoutMs: 50 });
    await expect(retriever.search("a")).rejects.toThrow("docsage não respondeu em 50 ms");
  });

  it("reports any other failure without its details, which could name the host", async () => {
    const retriever = new DocsageRetriever(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.7:8765");
    });
    const failure = await retriever.search("a").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(RetrieverUnavailable);
    expect((failure as Error).message).toBe("docsage está fora do ar");
  });

  it("gives up when it cannot even connect", async () => {
    const retriever = new DocsageRetriever(() => new Promise(() => {}), { timeoutMs: 50 });
    await expect(retriever.search("a")).rejects.toThrow("50 ms");
  });
});

describe("citation", () => {
  it("keeps the file name and the section", () => {
    expect(citation("C:\\conteudo\\devdek.md", "Stack")).toBe("devdek.md › Stack");
    expect(citation("profile.md", "")).toBe("profile.md");
  });
});
