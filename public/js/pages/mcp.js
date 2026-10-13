import { api } from "../api.js";
import { copyText, el } from "../dom.js";
import { formatMs, installSnippet } from "../lib.js";

const DEFAULT_ARGS = { get_project: "docsage", ask: "como funciona o docsage?" };
const CLIENTS = [
  ["code", "Claude Code"],
  ["desktop", "Claude Desktop"],
];
// Other MCP servers I wrote. The portfolio one is this site; docsage runs on your machine.
const SERVERS = [
  {
    name: "portfolio",
    transport: "http",
    where: "este site",
    desc: "Os mesmos dados do terminal: projetos, RAG e status do servidor.",
    cmd: (url) => installSnippet("code", url),
    tools: "list_projects · get_project · ask · get_status",
  },
  {
    name: "docsage",
    transport: "stdio",
    where: "local",
    desc: "Pergunte aos seus próprios documentos, com citações, de dentro do Claude.",
    cmd: () => "claude mcp add docsage -- docsage mcp",
    tools: "search_documents · ask_documents · index_path · index_stats",
  },
];

const rpc = (id, method, params) =>
  api("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

/** /mcp: how to connect, a playground that calls the real /mcp endpoint, and the servers I maintain. */
export function createMcpPage({ root }) {
  const $ = (sel) => root.querySelector(sel);
  const url = `${location.origin}/mcp`;
  let client = "code";
  let tools = null;
  let tool = null;
  let nextId = 1;
  let busy = false;

  function renderInstall() {
    $("#mcp-clients").replaceChildren(
      ...CLIENTS.map(([id, label]) =>
        el(
          "button",
          {
            type: "button",
            attrs: { role: "tab", "aria-selected": String(id === client) },
            on: {
              click: () => {
                client = id;
                renderInstall();
              },
            },
          },
          label,
        ),
      ),
    );
    $("#mcp-install").textContent = installSnippet(client, url);
  }

  function argName(t) {
    return Object.keys(t?.inputSchema?.properties ?? {})[0] ?? null;
  }

  function renderTools() {
    $("#mcp-tools").replaceChildren(
      ...tools.map((t) =>
        el(
          "button",
          {
            type: "button",
            class: "master-item",
            attrs: { role: "option", "aria-selected": String(t === tool) },
            on: { click: () => pick(t) },
          },
          el("span", { class: "master-name" }, `${t.name}(${argName(t) ?? ""})`),
          el("span", { class: "master-sub" }, t.description ?? ""),
        ),
      ),
    );
  }

  function pick(t) {
    tool = t;
    const name = argName(t);
    $("#mcp-arg-wrap").hidden = !name;
    $("#mcp-no-arg").hidden = Boolean(name);
    $("#mcp-arg-name").textContent = name ?? "";
    $("#mcp-arg").value = DEFAULT_ARGS[t.name] ?? "";
    $("#mcp-call").textContent = `chamar ${t.name}`;
    $("#mcp-res-head").textContent = "← response";
    $("#mcp-res").textContent = "chame a ferramenta para ver a resposta";
    renderTools();
    renderRequest();
  }

  function request() {
    const name = argName(tool);
    return {
      jsonrpc: "2.0",
      id: nextId,
      method: "tools/call",
      params: { name: tool.name, arguments: name ? { [name]: $("#mcp-arg").value } : {} },
    };
  }
  const renderRequest = () => ($("#mcp-req").textContent = JSON.stringify(request(), null, 2));

  async function call(e) {
    e.preventDefault();
    if (busy || !tool) return;
    busy = true;
    $("#mcp-call").disabled = true;
    $("#mcp-res").textContent = "…";
    const { params } = request();
    try {
      const { res, body, ms } = await rpc(nextId++, "tools/call", params);
      $("#mcp-res-head").textContent = `← response · ${res.status} · ${formatMs(ms)}`;
      $("#mcp-res").textContent = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    } catch {
      $("#mcp-res-head").textContent = "← sem resposta";
      $("#mcp-res").textContent = "A chamada não chegou ao servidor.";
    } finally {
      busy = false;
      $("#mcp-call").disabled = false;
      renderRequest();
    }
  }

  async function loadTools() {
    const { res, body } = await rpc(0, "tools/list", {});
    if (!res.ok || !body?.result) throw new Error("tools/list falhou");
    tools = body.result.tools;
    pick(tools.find((t) => t.name === "ask") ?? tools[0]);
  }

  function renderServers() {
    $("#mcp-servers").replaceChildren(
      ...SERVERS.map((s) =>
        el(
          "div",
          { class: "cell server-card" },
          el("div", { class: "card-meta" }, el("span", {}, s.transport), el("span", {}, s.where)),
          el("h3", {}, s.name),
          el("p", { class: "muted" }, s.desc),
          el("code", { class: "cmd" }, s.cmd(url)),
          el("span", { class: "card-meta" }, s.tools),
        ),
      ),
    );
  }

  let wired = false;
  return {
    root,
    enter() {
      if (!wired) {
        wired = true;
        renderInstall();
        renderServers();
        $("#mcp-copy").addEventListener("click", (e) => copyText($("#mcp-install").textContent, e.currentTarget));
        $("#mcp-form").addEventListener("submit", call);
        $("#mcp-arg").addEventListener("input", renderRequest);
      }
      if (!tools) {
        loadTools().catch(() => {
          $("#mcp-tools").replaceChildren(el("p", { class: "muted" }, "Não consegui listar as ferramentas agora."));
        });
      }
    },
  };
}
