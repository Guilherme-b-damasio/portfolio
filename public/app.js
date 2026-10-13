const out = document.getElementById("term-out");
const input = document.getElementById("term-input");
const history = [];
let historyIndex = 0;

// ---------- tiny DOM helpers (never innerHTML with API data) ----------
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children.flat()) node.append(child instanceof Node ? child : String(child));
  return node;
}
function print(...nodes) {
  out.append(el("div", {}, ...nodes));
  out.scrollTop = out.scrollHeight;
}
const dim = (text) => el("span", { className: "dim" }, text);
const warn = (text) => el("span", { className: "warn" }, text);

async function api(path, init) {
  const started = performance.now();
  const res = await fetch(path, init);
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  return { res, body, ms: Math.round(performance.now() - started) };
}

/** Highlights the query terms BM25 matched, so the visitor sees why a passage was picked. */
function highlight(text, terms) {
  if (!terms.length) return [text];
  const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const folded = fold(text);
  const parts = [];
  let last = 0;
  for (const m of folded.matchAll(pattern)) {
    parts.push(text.slice(last, m.index), el("mark", {}, text.slice(m.index, m.index + m[0].length)));
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

// ---------- commands ----------
const commands = {
  help() {
    print(
      [
        "whoami              quem sou eu",
        "ls projects         lista os projetos",
        "cat <projeto>       detalhes de um projeto",
        'ask "<pergunta>"    pergunta ao RAG sobre mim',
        "status              métricas ao vivo deste servidor",
        "curl <caminho>      chama a API crua, ex: curl /api/profile",
        "clear               limpa a tela",
      ].join("\n"),
    );
  },

  async whoami() {
    const { body } = await api("/api/profile");
    print(el("b", {}, body.name), dim(`  ${body.role}${body.location ? " · " + body.location : ""}`));
    print(
      body.body
        .split("\n")
        .filter((l) => !l.startsWith("##"))
        .join("\n")
        .trim(),
    );
  },

  async ls(args) {
    if (args[0] && args[0] !== "projects") return print(warn(`ls: ${args[0]}: tente 'ls projects'`));
    const { body } = await api("/api/projects");
    for (const p of body) print(el("span", { className: "cmd" }, p.slug.padEnd(16)), p.summary);
  },

  async cat(args) {
    const slug = (args[0] ?? "").replace(/\.md$/, "");
    if (!slug) return print(warn("uso: cat <projeto>"));
    const { res, body } = await api(`/api/projects/${encodeURIComponent(slug)}`);
    if (!res.ok) return print(warn(body.error));
    print(el("b", {}, body.name), dim(`  [${body.stack.join(", ")}]`));
    print(body.body);
    if (body.repo) print(dim("repo: "), el("a", { href: body.repo, target: "_blank", rel: "noopener" }, body.repo));
  },

  async ask(args) {
    const question = args.join(" ").replace(/^["']|["']$/g, "");
    if (!question) return print(warn('uso: ask "sua pergunta"'));
    print(dim("buscando trechos…"));
    const { res, body, ms } = await api("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) return print(warn(body.error ?? `erro ${res.status}`));

    if (body.answer) print(body.answer);
    else if (!body.passages.length) print(warn("Nada no meu conteúdo bate com essa pergunta."));
    else print(dim("(LLM desligado neste ambiente: mostrando só a recuperação)"));

    for (const hit of body.passages) {
      print(
        el(
          "div",
          { className: "hit" },
          dim(`${hit.score.toFixed(2)}  ${hit.chunk.source}\n`),
          highlight(hit.chunk.text.slice(0, 280), hit.matchedTerms),
        ),
      );
    }
    const gen = body.latencyMs.generation;
    print(
      dim(
        `bm25 ${body.latencyMs.retrieval.toFixed(1)}ms` +
          (gen != null
            ? ` · ${body.model} ${Math.round(gen)}ms · ${body.usage.inputTokens}→${body.usage.outputTokens} tokens`
            : "") +
          ` · total ${ms}ms · rate limit restante ${res.headers.get("x-ratelimit-remaining")}`,
      ),
    );
  },

  async status() {
    const { body } = await api("/api/status");
    print(
      [
        `pod        ${body.runtime.pod}${body.runtime.node_name ? " @ " + body.runtime.node_name : ""}`,
        `uptime     ${formatUptime(body.uptimeSeconds)}`,
        `memória    ${body.memory.rssMb} MB rss`,
        `req/min    ${body.requestsLastMinute}`,
        `llm        ${body.llm ?? "desligado"}`,
        `commit     ${body.build.commit}`,
      ].join("\n"),
    );
  },

  async curl(args) {
    const path = args.find((a) => a.startsWith("/"));
    if (!path) return print(warn("uso: curl /api/..."));
    const { res, body, ms } = await api(path);
    print(dim(`HTTP ${res.status} · ${ms}ms · ${res.headers.get("content-type")}`));
    print(typeof body === "string" ? body.slice(0, 2000) : JSON.stringify(body, null, 2));
  },

  clear() {
    out.replaceChildren();
  },
};

async function run(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  history.push(trimmed);
  historyIndex = history.length;
  print(el("span", { className: "cmd" }, "$ "), trimmed);

  const [name, ...args] = trimmed.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const command = commands[name.toLowerCase()];
  if (!command) return print(warn(`${name}: comando não encontrado. Digite 'help'.`));
  try {
    await command(args);
  } catch (err) {
    print(warn(`falhou: ${err.message}`));
  }
}

document.getElementById("term-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const line = input.value;
  input.value = "";
  run(line);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" && historyIndex > 0) input.value = history[--historyIndex];
  else if (e.key === "ArrowDown") input.value = history[++historyIndex] ?? ((historyIndex = history.length), "");
  else return;
  e.preventDefault();
});
document.getElementById("chips").addEventListener("click", (e) => {
  const cmd = e.target.closest("button")?.dataset.cmd;
  if (cmd) run(cmd);
});

// ---------- page sections ----------
async function renderProfile() {
  const { body } = await api("/api/profile");
  document.getElementById("name").textContent = body.name;
  document.getElementById("role").textContent = body.role;
  document.title = `${body.name} · ${body.role}`;
  const links = document.getElementById("links");
  for (const [label, href] of Object.entries(body.links ?? {})) {
    if (href.includes("TODO")) continue;
    links.append(
      el("a", { href: label === "email" ? `mailto:${href}` : href, target: "_blank", rel: "noopener" }, label),
    );
  }
}

async function renderProjects() {
  const { body } = await api("/api/projects");
  const grid = document.getElementById("projects");
  for (const p of body) {
    const open = el("button", { type: "button" }, "abrir no terminal");
    open.addEventListener("click", () => {
      run(`cat ${p.slug}`);
      document.getElementById("terminal").scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const actions = el("div", { className: "card-actions" }, open);
    if (p.repo) actions.append(el("a", { href: p.repo, target: "_blank", rel: "noopener" }, "repo"));
    grid.append(
      el(
        "article",
        { className: "card" },
        el("h3", {}, p.name),
        el("p", {}, p.summary),
        el(
          "div",
          { className: "tags" },
          p.stack.map((s) => el("span", {}, s)),
        ),
        actions,
      ),
    );
  }
}

function formatUptime(s) {
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

async function renderStatus() {
  try {
    const { body } = await api("/api/status");
    const stat = (value, label) => el("div", { className: "stat" }, el("b", {}, value), el("span", {}, label));
    document
      .getElementById("stats")
      .replaceChildren(
        stat(formatUptime(body.uptimeSeconds), "uptime"),
        stat(String(body.requestsLastMinute), "requests no último minuto"),
        stat(`${body.memory.rssMb} MB`, "memória (rss)"),
        stat(body.runtime.pod.slice(-12), body.runtime.node_name ? `pod @ ${body.runtime.node_name}` : "host"),
      );
    document.querySelector("#routes tbody").replaceChildren(
      ...body.routes
        .filter((r) => !r.route.endsWith("static"))
        .sort((a, b) => b.count - a.count)
        .map((r) =>
          el(
            "tr",
            {},
            el("td", {}, r.route),
            el("td", {}, r.count),
            el("td", {}, `${r.p50Ms}ms`),
            el("td", {}, `${r.p95Ms}ms`),
            el("td", {}, r.errors),
          ),
        ),
    );
    document.getElementById("build").textContent = `build ${body.build.commit.slice(0, 7)} · node ${body.runtime.node}`;
  } catch {
    /* status panel is best-effort; the next tick retries */
  }
}

print(dim("Bem-vindo. Isto aqui fala com a API de verdade. Digite 'help'."));
renderProfile();
renderProjects();
renderStatus();
setInterval(renderStatus, 5000);
