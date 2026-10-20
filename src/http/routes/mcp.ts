import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { ApiDeps, AskGuards } from "./api.js";
import { rateLimit, TokenBucket } from "../middleware/rate-limit.js";

const readOnly = { readOnlyHint: true, openWorldHint: false };
const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data as Record<string, unknown>,
});

/** One server per request: stateless, so there is no session to keep or leak between visitors. */
function buildServer({ browse, askQuestion, reportStatus }: ApiDeps, { bucket, gate }: AskGuards, clientKey: string) {
  const server = new McpServer({ name: "portfolio", version: "0.1.0" });

  server.registerTool(
    "list_projects",
    { description: "Lista os projetos do portfólio com slug, resumo, stack e tags.", annotations: readOnly },
    async () => json({ projects: browse.projects() }),
  );

  server.registerTool(
    "get_project",
    {
      description: "Texto completo de um projeto, em Markdown.",
      inputSchema: { slug: z.string().min(1).max(80) },
      annotations: readOnly,
    },
    async ({ slug }) => {
      const project = browse.project(slug);
      if (!project) return { content: [{ type: "text", text: `projeto "${slug}" não encontrado` }], isError: true };
      return json(project);
    },
  );

  server.registerTool(
    "ask",
    {
      description: "Pergunta ao RAG sobre o dono do site; devolve a resposta (se o LLM estiver ligado) e os trechos.",
      inputSchema: { question: z.string().trim().min(2).max(500) },
      annotations: readOnly,
    },
    async ({ question }) => {
      const release = gate.tryAcquire();
      if (!release) {
        return {
          content: [
            { type: "text", text: `Muitas perguntas ao mesmo tempo. Tente de novo em ${gate.retryAfterSeconds}s.` },
          ],
          isError: true,
        };
      }
      const { allowed, state } = bucket.take(clientKey);
      if (!allowed) {
        release();
        return {
          content: [
            { type: "text", text: `Limite de perguntas atingido. Tente de novo em ${state.retryAfterSeconds}s.` },
          ],
          isError: true,
        };
      }
      try {
        return json(await askQuestion.execute(question));
      } finally {
        release();
      }
    },
  );

  server.registerTool(
    "get_status",
    { description: "Uptime, memória, pod, nó e commit deste servidor.", annotations: readOnly },
    async () => {
      const { routes: _routes, ...status } = reportStatus.status();
      return json(status);
    },
  );

  return server;
}

/** Streamable HTTP MCP endpoint, read-only, rate limited per visitor. */
export function mcpRouter(deps: ApiDeps, askGuards: AskGuards) {
  const router = express.Router();
  const calls = new TokenBucket(60, 60);

  router.post(
    "/",
    rateLimit(calls, "Muitas chamadas MCP seguidas. Tenta de novo em instantes."),
    async (req, res, next) => {
      const server = buildServer(deps, askGuards, req.ip ?? "unknown");
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        next(err);
      }
    },
  );

  // Stateless: no server-initiated stream (GET) and no session to end (DELETE).
  router.all("/", (_req, res) => {
    res
      .status(405)
      .set("allow", "POST")
      .json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Use POST: este servidor MCP não mantém sessão." },
        id: null,
      });
  });

  return router;
}
