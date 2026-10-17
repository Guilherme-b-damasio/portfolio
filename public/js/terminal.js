import { api, apiStream, lastTraceId, recordTraces } from "./api.js";
import { el } from "./dom.js";
import { collectProbe } from "./probe.js";
import {
  citationParts,
  commandForSource,
  formatAttrs,
  formatMs,
  formatUptime,
  formatUsd,
  guessCommand,
  highlightParts,
  PAGES,
  parseLine,
  rememberTurn,
  scanHeadline,
  scoreBar,
  sections,
  takeFlag,
  takeOption,
  VERDICTS,
  waterfallRows,
} from "./lib.js";

const COMMANDS = ["help", "whoami", "ls", "cat", "ask", "status", "trace", "scan", "curl", "open", "clear"];
const OPENABLE = PAGES.filter((p) => p !== "inicio");
const CHIPS = ["whoami", "ls projects", 'ask "como funciona o docsage?"', "status", "curl /api/projects", "help"];
const isTodo = (text) => /^TODO\b/.test(text.trim());

// ---------- segments: the pieces a terminal line is made of ----------
const text = (t, cls) => el("span", { class: cls }, t);
const dim = (t) => text(t, "t-dim");
const acc = (t) => text(t, "t-acc");
const warn = (t) => text(t, "t-warn");
const bold = (t) => text(t, "t-bold");

export function createTerminal({ out, form, input, hint, chips, bucket, projects, navigate }) {
  const history = [];
  let historyIndex = 0;
  let quota = null; // { remaining, limit, refillPerMinute, at }
  let busy = false;
  let conversation = []; // last turns with a generated answer, sent with the next ask as a follow-up

  // ---------- output ----------
  function line(segments, cls) {
    return el("div", { class: cls ? `t-line ${cls}` : "t-line" }, segments);
  }
  function print(...lines) {
    out.append(...lines);
    out.scrollTop = out.scrollHeight;
  }
  const say = (...segments) => print(line(segments));
  const runButton = (label, command, aria, cls = "t-btn") =>
    el(
      "button",
      { type: "button", class: cls, attrs: { "aria-label": aria ?? label }, on: { click: () => run(command) } },
      label,
    );
  const cite = (label, command) =>
    el(
      "button",
      { type: "button", class: "t-cite", title: "abrir o trecho citado", on: { click: () => run(command) } },
      label,
    );

  // ---------- the question bucket in the title bar ----------
  function tokensNow() {
    if (!quota) return null;
    const refilled = quota.remaining + ((Date.now() - quota.at) / 60_000) * quota.refillPerMinute;
    return Math.min(quota.limit, Math.floor(refilled));
  }
  function renderBucket() {
    const tokens = tokensNow();
    if (tokens == null) return;
    const cells = Array.from({ length: quota.limit }, (_, i) => el("span", { class: i < tokens ? "on" : "" }));
    bucket.cells.replaceChildren(...cells);
    bucket.count.textContent = `${tokens}/${quota.limit}`;
    bucket.root.setAttribute("aria-label", `${tokens} de ${quota.limit} perguntas disponíveis`);
    bucket.root.hidden = false;
  }
  function setQuota({ remaining, limit, refillPerMinute }) {
    quota = { remaining, limit, refillPerMinute: refillPerMinute ?? quota?.refillPerMinute ?? 5, at: Date.now() };
    renderBucket();
  }
  async function loadQuota() {
    try {
      const { res, body } = await api("/api/ask/quota", { auto: true });
      if (res.ok) setQuota(body);
    } catch {
      /* the bucket stays hidden; asking still works */
    }
  }
  setInterval(renderBucket, 1000);

  // ---------- commands ----------
  const commands = {
    help() {
      const rows = [
        ["whoami", "quem sou eu"],
        ["ls projects", "lista os projetos"],
        ["cat <projeto>", "detalhes de um projeto"],
        ['ask "<pergunta>"', "pergunta ao RAG sobre mim"],
        ['ask --xray "<pergunta>"', "a mesma pergunta, mostrando cada etapa"],
        ['ask --new "<pergunta>"', "esquece a conversa e começa outra"],
        ['ask --engine docsage "<pergunta>"', "busca no docsage em vez do índice local"],
        ["status", "métricas ao vivo deste servidor"],
        ["trace [id]", "cada etapa da última requisição (ou da do id)"],
        ["(clique num comando)", "abre o trace da requisição que ele fez"],
        ["scan", "o que este site sabe sobre você"],
        ["curl <caminho>", "chama a API crua, ex: curl /api/profile"],
        ["open <página>", OPENABLE.join(" · ")],
        ["clear", "limpa a tela"],
      ];
      print(...rows.map(([c, d]) => line([acc(c.padEnd(24)), dim(d)])));
    },

    async whoami() {
      const { body } = await api("/api/profile");
      say(bold(body.name), dim(`  ${body.role}${body.location ? " · " + body.location : ""}`));
      for (const [title, content] of sections(body.body)) {
        if (isTodo(content)) {
          print(line([dim(`## ${title}  (texto em escrita)`)], "t-gap"));
          continue;
        }
        print(line([acc(`## ${title}`)], "t-gap"), line([content]));
      }
    },

    async ls(args) {
      if (args[0] && args[0] !== "projects") return say(warn("! "), `ls: ${args[0]}: tente 'ls projects'`);
      const { body } = await api("/api/projects");
      projects.set(body.map((p) => p.slug));
      print(...body.map((p) => line([runButton(p.slug.padEnd(16), `cat ${p.slug}`, `abrir ${p.slug}`), p.summary])));
    },

    async cat(args) {
      const slug = (args[0] ?? "").replace(/\.md$/, "");
      const only = args.slice(1).join(" ");
      if (!slug) return say(warn("! "), "uso: cat <projeto>");
      const { res, body } = await api(`/api/projects/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        return print(
          line([warn("! 404 "), `projeto "${slug}" não encontrado`]),
          line([dim("rode "), runButton("ls projects", "ls projects")]),
        );
      }
      if (!res.ok) return failed(res.status);
      say(bold(body.name), dim(`  [${body.stack.join(", ")}]`));
      const all = sections(body.body);
      const picked = only ? all.filter(([title]) => title === only) : all;
      if (only) say(dim("trecho citado · "), runButton("ver tudo", `cat ${body.slug}`, "ver projeto completo"));
      for (const [title, content] of picked) {
        if (isTodo(content)) print(line([dim(`## ${title}  (em escrita)`)], "t-gap"));
        else print(line([acc(`## ${title}`)], "t-gap"), line([content]));
      }
      if (body.repo) {
        print(
          line(
            [
              dim("repo: "),
              el("a", { href: body.repo, target: "_blank", rel: "noopener", class: "t-link" }, body.repo),
            ],
            "t-gap",
          ),
        );
      }
    },

    async ask(args) {
      const { on: xray, rest: withoutXray } = takeFlag(args, "--xray");
      const { on: fresh, rest: withoutNew } = takeFlag(withoutXray, "--new");
      const { value: engine, rest } = takeOption(withoutNew, "--engine");
      const question = rest.join(" ");
      if (!question || engine === "")
        return say(warn("! "), 'uso: ask [--xray] [--new] [--engine docsage|local] "sua pergunta"');
      if (fresh) conversation = [];
      const history = conversation;
      if (history.length) {
        const carried = history.length === 1 ? "a pergunta anterior" : `as últimas ${history.length} perguntas`;
        say(dim(`follow-up: levo ${carried} junto · ask --new recomeça`));
      }

      let loading = line([acc("·   "), dim("buscando trechos…")]);
      print(loading);
      let frame = 0;
      const spin = setInterval(() => {
        frame++;
        loading.firstChild.textContent = ["·   ", "··  ", "··· "][frame % 3];
      }, 260);

      // The answer is written into this line as the server streams it, then rebuilt with citations.
      let streamed = null;
      const onEvent = (event, data) => {
        if (event === "passages" && data.passages.length) {
          loading.lastChild.textContent = `${data.passages.length} trechos em ${formatMs(data.retrievalMs)}, escrevendo…`;
        } else if (event === "text") {
          if (!streamed) {
            clearInterval(spin);
            streamed = line([], "t-answer t-streaming");
            loading.replaceWith(streamed);
            loading = streamed;
          }
          streamed.append(data.delta);
          out.scrollTop = out.scrollHeight;
        }
      };

      let response;
      try {
        response = await apiStream(
          "/api/ask",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              question,
              ...(xray && { xray }),
              ...(history.length && { history }),
              ...(engine && { engine: engine.toLowerCase() }),
            }),
          },
          onEvent,
        );
      } catch {
        clearInterval(spin);
        loading.remove();
        return failed(0);
      }
      clearInterval(spin);
      streamed?.classList.remove("t-streaming");
      const { res, body, ms } = response;
      const remaining = Number(res.headers.get("x-ratelimit-remaining"));
      const limit = Number(res.headers.get("x-ratelimit-limit"));
      if (limit) setQuota({ remaining, limit });

      if (res.status === 429) {
        loading.remove();
        const perToken = Math.round(60 / (quota?.refillPerMinute ?? 5));
        return print(
          line([warn("! 429 "), body.error]),
          line([
            dim("fichas  "),
            acc("■".repeat(remaining) + "□".repeat(Math.max(0, limit - remaining))),
            dim(`  · ${limit} por visitante, +1 a cada ${perToken}s`),
          ]),
        );
      }
      if (res.status === 503 && body?.error) {
        loading.remove();
        const retry = Number(res.headers.get("retry-after")) || 5;
        return print(
          line([warn("! 503 "), body.error]),
          line([
            dim(`teto global de perguntas simultâneas; sua ficha não foi gasta. espere ~${retry}s e `),
            runButton(
              "tente de novo",
              `ask ${xray ? "--xray " : ""}${engine ? `--engine ${engine} ` : ""}"${question.replaceAll('"', "")}"`,
            ),
          ]),
        );
      }
      if (!res.ok) {
        loading.remove();
        return res.status >= 500 ? failed(res.status) : say(warn("! "), body.error ?? `erro ${res.status}`);
      }
      if (body.error) {
        // The stream broke after it opened: keep what was written and say it stopped.
        if (!streamed) loading.remove();
        return say(warn("! "), body.error);
      }

      if (body.engineFallback) {
        loading.before(line([warn("! "), `${body.engineFallback}; busquei no índice local.`]));
      }

      if (!body.passages.length) {
        loading.replaceWith(line([warn("! "), "Nada no meu conteúdo bate com essa pergunta."]));
        return say(
          dim("tente "),
          runButton('ask "o que é o docsage?"', 'ask "o que é o docsage?"', "rodar sugestão"),
          dim(" ou "),
          runButton("ls projects", "ls projects"),
        );
      }

      if (body.answer) {
        conversation = rememberTurn(conversation, { question, answer: body.answer });
        const parts = citationParts(body.answer).map((p) =>
          p.source ? cite(p.text, commandForSource(p.source)) : p.text,
        );
        loading.replaceWith(line(parts, "t-answer"));
      } else if (body.degraded === "token-budget") {
        loading.replaceWith(
          line([
            warn("! "),
            "O orçamento diário de tokens do LLM acabou. Até 00:00 UTC mostro só os trechos recuperados.",
          ]),
        );
      } else {
        loading.replaceWith(line([dim("(LLM desligado neste ambiente: mostrando só a recuperação)")]));
      }

      for (const hit of body.passages) {
        const excerpt = highlightParts(hit.chunk.text.slice(0, 280), hit.matchedTerms).map((p) =>
          p.mark ? el("mark", {}, p.text) : p.text,
        );
        print(
          line(
            [
              dim(`${hit.score.toFixed(2)}  `),
              cite(hit.chunk.source, commandForSource(hit.chunk.source)),
              "\n",
              excerpt,
            ],
            "t-hit",
          ),
        );
      }

      const { retrieval, generation } = body.latencyMs;
      const searchedWith = body.engine && body.engine !== "local" ? body.engine : "bm25";
      const parts = [`${searchedWith} ${formatMs(retrieval)}`];
      if (generation != null) {
        parts.push(
          `${body.model} ${formatMs(generation)}`,
          `${body.usage.inputTokens}→${body.usage.outputTokens} tokens`,
        );
      }
      parts.push(`total ${formatMs(ms)}`, `rate limit restante ${remaining}`);
      const traceId = res.headers.get("x-trace-id");
      print(
        line(
          [
            dim(parts.join(" · ")),
            ...(traceId ? [dim(" · "), runButton("trace", `trace ${traceId}`, "ver o trace")] : []),
          ],
          "t-meta",
        ),
      );
      if (body.xray) printXray(body);
    },

    async status() {
      const { res, body } = await api("/api/status");
      if (!res.ok) return failed(res.status);
      const rows = [
        ["pod", `${body.runtime.pod}${body.runtime.node_name ? " @ " + body.runtime.node_name : ""}`],
        ["uptime", formatUptime(body.uptimeSeconds)],
        ["memória", `${body.memory.rssMb} MB rss`],
        ["req/min", String(body.requestsLastMinute)],
        ["llm", body.llm ?? "desligado"],
        ...(body.llmBudget
          ? [
              [
                "tokens/dia",
                `${body.llmBudget.used.toLocaleString("pt-BR")} de ${body.llmBudget.limit.toLocaleString("pt-BR")}`,
              ],
            ]
          : []),
        ["commit", body.build.commit.slice(0, 7)],
      ];
      print(...rows.map(([k, v]) => line([dim(k.padEnd(11)), v])));
    },

    async trace(args) {
      const id = args[0] ?? lastTraceId();
      if (!id) return say(warn("! "), "uso: trace <id> · o id vem no header x-trace-id de cada resposta da API");
      if (!/^[0-9a-f]{16}$/.test(id)) return say(warn("! "), `trace: "${id.slice(0, 40)}" não é um id de trace`);
      const { res, body } = await api(`/api/traces/${id}`);
      if (res.status === 404) return say(warn("! 404 "), body.error);
      if (!res.ok) return failed(res.status);

      say(dim(`trace ${body.id} · ${body.status} · ${formatMs(body.durationMs)} · ${body.startedAt}`));
      const rows = waterfallRows(body);
      const label = Math.min(16, Math.max(...rows.map((r) => r.name.length)));
      for (const r of rows) {
        const cls = r.error ? "t-warn" : "t-acc";
        print(
          line([
            text(r.name.slice(0, label).padEnd(label + 2), r.error ? "t-warn" : undefined),
            dim("·".repeat(r.pad)),
            text("█".repeat(r.bar), cls),
            dim("·".repeat(24 - r.pad - r.bar)),
            ` ${formatMs(r.ms).padStart(7)}`,
            dim(formatAttrs(r.attrs) ? `  ${formatAttrs(r.attrs)}` : ""),
          ]),
        );
      }
      if (body.droppedSpans) say(dim(`+${body.droppedSpans} etapas além do limite por trace`));
      if (!body.spans.length) say(dim("sem etapas internas: a rota respondeu direto"));
    },

    async scan() {
      const loading = line([acc("·   "), dim("sondando o navegador…")]);
      print(loading);
      const probe = await collectProbe().catch(() => null);
      const { res, body } = await api(
        "/api/scan",
        probe
          ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(probe) }
          : undefined,
      );
      loading.remove();
      if (!res.ok) return res.status >= 500 ? failed(res.status) : say(warn("! "), body.error ?? `erro ${res.status}`);

      say(bold(scanHeadline(body)));
      const marks = { contradicao: "✗", exposto: "!", info: "·", ok: "✓" };
      for (const f of body.findings.filter((f) => f.verdict !== "ok")) {
        const tag = `${marks[f.verdict]} ${VERDICTS[f.verdict]}`.padEnd(15);
        print(line([f.verdict === "info" ? dim(tag) : warn(tag), f.title]));
      }
      const ok = body.findings.filter((f) => f.verdict === "ok").length;
      say(
        dim(`${ok} verificações ok · ${body.summary.checks} regras · nada foi salvo  `),
        runButton("ver evidências em /voce", "open voce"),
      );
    },

    async curl(args) {
      const path = args.find((a) => a.startsWith("/"));
      if (!path) return say(warn("! "), "uso: curl /api/...");
      const { res, body, ms, type } = await api(path);
      const head = `HTTP ${res.status} · ${formatMs(ms)} · ${type}`;
      say(res.ok ? dim(head) : warn(head));
      say(typeof body === "string" ? body.slice(0, 2000) : JSON.stringify(body, null, 2).slice(0, 4000));
    },

    open(args) {
      const page = (args[0] ?? "").replace(/^\//, "");
      if (!PAGES.includes(page)) return say(warn("! "), `uso: open ${OPENABLE.join(" | ")}`);
      say(dim(`abrindo /${page}…`));
      setTimeout(() => navigate(page), 250);
    },

    clear() {
      out.replaceChildren();
      conversation = [];
    },
  };

  // ---------- ask --xray: each step the answer went through ----------
  function printXray({ xray, model, usage, latencyMs, degraded }) {
    const step = (n, title, detail = "") => line([acc(`${n} ${title}`), dim(detail ? `  ${detail}` : "")], "t-gap");
    print(line([bold("── raio-x ──")], "t-gap"));

    print(step(1, "tokenização", "a pergunta como o índice a lê: minúsculas, sem acento, sem stopwords"));
    if (xray.terms) say(...xray.terms.flatMap((t) => [text(t, "t-token"), " "]));
    else say(dim("este recuperador não expõe os termos"));

    const kept = xray.ranking.filter((r) => r.kept).length;
    print(step(2, "ranking BM25", `${xray.ranking.length} candidatos, ${kept} vão para o prompt`));
    const best = xray.ranking[0]?.score ?? 0;
    for (const r of xray.ranking) {
      print(
        line(
          [
            r.kept ? acc("✓ ") : dim("· "),
            text(scoreBar(r.score, best), r.kept ? "t-acc" : "t-dim"),
            dim(` ${r.score.toFixed(2).padStart(6)}  `),
            cite(r.source, commandForSource(r.source)),
            dim(r.matchedTerms.length ? `  [${r.matchedTerms.join(", ")}]` : ""),
          ],
          r.kept ? "" : "t-cut",
        ),
      );
    }
    if (!xray.ranking.length) say(dim("nenhum trecho com score acima de zero"));

    if (!xray.prompt) {
      print(step(3, "prompt"), line([dim("sem LLM neste ambiente: não há prompt")]));
      return;
    }
    const size = xray.prompt.system.length + xray.prompt.user.length;
    print(step(3, "prompt montado", `${size} caracteres`));
    const details = el(
      "details",
      { class: "t-prompt" },
      el("summary", {}, "ver o prompt exato"),
      el(
        "pre",
        {},
        [
          `# system\n${xray.prompt.system}`,
          ...(xray.prompt.history ?? []).flatMap((t) => [`# user\n${t.question}`, `# assistant\n${t.answer}`]),
          `# user\n${xray.prompt.user}`,
        ].join("\n\n"),
      ),
    );
    print(details);

    if (!xray.generation) {
      print(
        step(4, "geração"),
        line([dim(degraded === "token-budget" ? "não enviado: o orçamento diário acabou" : "não houve geração")]),
      );
      return;
    }
    const g = xray.generation;
    const parts = [model];
    if (g.firstTokenMs != null) parts.push(`1º token em ${formatMs(g.firstTokenMs)}`);
    parts.push(
      `${g.tokensPerSecond.toFixed(0)} tokens/s`,
      `${usage.inputTokens}→${usage.outputTokens} tokens em ${formatMs(latencyMs.generation)}`,
    );
    print(step(4, "geração"), line([parts.join(" · ")]));
    say(
      g.costUsd != null ? acc(`~${formatUsd(g.costUsd)}`) : dim("custo: preço do modelo desconhecido"),
      dim(g.costUsd != null ? "  estimado pela tabela de preços (inclui tokens de raciocínio)" : ""),
    );
  }

  function failed(status) {
    print(
      line([warn(status ? `! erro ${status} ` : "! sem resposta "), "A API não respondeu."]),
      line([
        dim("O pod pode estar reiniciando. Rode "),
        runButton("status", "status"),
        dim(" ou tente de novo em alguns segundos."),
      ]),
    );
  }

  async function run(raw) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed || busy) return;
    history.push(trimmed);
    historyIndex = history.length;
    const echo = line([acc("$ "), trimmed]);
    print(echo);

    const [name, ...args] = parseLine(trimmed);
    const command = commands[name.toLowerCase()];
    if (!command) {
      const guess = guessCommand(name.toLowerCase(), COMMANDS);
      say(warn("! "), `${name}: comando não encontrado. Digite 'help'.`);
      if (guess) say(dim("você quis dizer "), runButton(guess, guess), dim("?"));
      return;
    }
    busy = true;
    const stop = recordTraces();
    try {
      await command(args);
    } catch {
      failed(0);
    } finally {
      busy = false;
      linkTraces(echo, trimmed, stop());
    }
  }

  // Once a command finished, its echo line opens the trace of the request it made (the last one,
  // with the earlier ones numbered beside it). Commands that never reached the API stay plain text.
  function linkTraces(echo, command, ids) {
    if (!ids.length) return;
    const last = ids[ids.length - 1];
    const open = el(
      "button",
      {
        type: "button",
        class: "t-cmd",
        title: "ver o trace deste comando",
        attrs: { "aria-label": `ver o trace de ${command}` },
        on: { click: () => run(`trace ${last}`) },
      },
      command,
    );
    const earlier =
      ids.length > 1
        ? [
            dim("  traces "),
            ...ids
              .map((id, i) => runButton(`#${i + 1}`, `trace ${id}`, `trace ${i + 1} de ${ids.length}`))
              .flatMap((b) => [b, " "]),
          ]
        : [];
    echo.replaceChildren(acc("$ "), open, ...earlier);
  }

  // ---------- input ----------
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value;
    input.value = "";
    run(value);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && historyIndex > 0) {
      input.value = history[--historyIndex];
    } else if (e.key === "ArrowDown" && history.length) {
      historyIndex = Math.min(historyIndex + 1, history.length);
      input.value = history[historyIndex] ?? "";
    } else if (e.key === "Tab" && input.value.trim()) {
      const words = input.value.split(" ");
      const pool =
        words.length === 1
          ? COMMANDS
          : words[0] === "cat"
            ? projects.get()
            : words[0] === "ls"
              ? ["projects"]
              : words[0] === "open"
                ? OPENABLE
                : words[0] === "ask" && words.length === 2
                  ? ["--xray", "--new", "--engine"]
                  : words[0] === "ask" && words[words.length - 2] === "--engine"
                    ? ["docsage", "local"]
                    : [];
      const matches = pool.filter((c) => c.startsWith(words[words.length - 1]));
      if (!matches.length) return;
      if (matches.length === 1) {
        words[words.length - 1] = matches[0];
        input.value = words.join(" ") + " ";
      } else {
        say(dim(matches.join("   ")));
      }
    } else {
      return;
    }
    e.preventDefault();
  });

  chips.replaceChildren(
    ...CHIPS.map((c) =>
      el(
        "button",
        { type: "button", class: "chip", on: { click: () => run(c) } },
        el("span", { attrs: { "aria-hidden": "true" } }, "›"),
        c,
      ),
    ),
  );

  // Phones get a shorter placeholder and just the ↵ hint: tapping a chip beats typing there.
  const narrow = matchMedia("(max-width: 559px)");
  const fit = () => {
    input.placeholder = narrow.matches ? "toque numa sugestão ou digite" : 'ask "que projetos de IA você tem?"';
    hint.textContent = narrow.matches ? "↵" : "tab ↹  ↑↓  ↵";
  };
  narrow.addEventListener("change", fit);
  fit();

  say(dim("Bem-vindo. Isto aqui fala com a API de verdade. Digite 'help' ou toque numa sugestão."));
  loadQuota();
  return { run };
}
