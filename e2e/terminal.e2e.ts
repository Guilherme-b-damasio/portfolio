import { test as base, expect, type Page } from "@playwright/test";

// Every test opens the home page and, at the end, fails on any uncaught error or CSP violation it saw.
const test = base.extend<{ home: Page }>({
  home: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("response", (res) => {
      if (res.status() >= 400) errors.push(`${res.status()} ${new URL(res.url()).pathname}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await expect(page.locator("#term-out")).toContainText("Bem-vindo");
    await use(page);
    expect(errors).toEqual([]);
  },
});

async function run(page: Page, command: string) {
  const input = page.getByRole("textbox", { name: "Comando do terminal" });
  await input.fill(command);
  await input.press("Enter");
}

test("help lists the commands", async ({ home }) => {
  await run(home, "help");
  const out = home.locator("#term-out");
  for (const cmd of ["ask", "status", "scan", "curl"]) await expect(out).toContainText(cmd);
});

test("ask answers from the real index and spends one question", async ({ home }) => {
  await run(home, 'ask "o que é o docsage?"');
  const out = home.locator("#term-out");
  // No LLM key in this run: the answer is the BM25 ranking itself, with citations that open the source.
  await expect(out).toContainText("mostrando só a recuperação");
  await expect(out.locator(".t-hit").first()).toBeVisible();
  await expect(out.locator(".t-meta").last()).toContainText("bm25");
  await expect(home.locator("#bucket-count")).toHaveText(/^\d+\/\d+$/);
});

test("ask --engine docsage says docsage is off here and answers from the local index", async ({ home }) => {
  // No DOCSAGE_MCP_URL in this run, so the real server falls back and says why.
  await run(home, 'ask --engine docsage "o que é o docsage?"');
  const out = home.locator("#term-out");
  await expect(out).toContainText("docsage não está ligado neste servidor; busquei no índice local.");
  await expect(out.locator(".t-hit").first()).toBeVisible();
  await expect(out.locator(".t-meta").last()).toContainText("bm25");
});

test("status reports the live process", async ({ home }) => {
  await run(home, "status");
  const out = home.locator("#term-out");
  await expect(out).toContainText("uptime");
  await expect(out).toContainText("memória");
  await expect(out).toContainText(/llm\s+desligado/);
});

test("the page does not scroll sideways", async ({ home }) => {
  const overflow = await home.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("ask renders a streamed answer with clickable citations", async ({ home }) => {
  // The CI server has no LLM key, so the stream is replayed here; the parsing and rendering are real.
  const passage = {
    chunk: { id: "docsage.md#0", source: "docsage.md › O que é", text: "RAG" },
    score: 2,
    matchedTerms: [],
  };
  const done = {
    answer: "É um RAG [docsage.md › O que é].",
    passages: [passage],
    model: "claude-test",
    usage: { inputTokens: 40, outputTokens: 9 },
    latencyMs: { retrieval: 1, generation: 20 },
    degraded: null,
  };
  const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  await home.route("**/api/ask", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "x-ratelimit-remaining": "4", "x-ratelimit-limit": "5" },
      body:
        sse("passages", { passages: [passage], retrievalMs: 1 }) +
        sse("text", { delta: "É um RAG " }) +
        sse("text", { delta: "[docsage.md › O que é]." }) +
        sse("done", done),
    }),
  );
  await run(home, 'ask "o que é o docsage?"');
  const answer = home.locator("#term-out .t-answer").last();
  await expect(answer).toContainText("É um RAG");
  await expect(answer).not.toHaveClass(/t-streaming/);
  await expect(answer.getByRole("button", { name: "docsage.md › O que é" })).toBeVisible();
  await expect(home.locator("#term-out .t-meta").last()).toContainText("40→9 tokens");
});

test("ask --xray shows the real tokenization and BM25 ranking", async ({ home }) => {
  await run(home, 'ask --xray "como funciona o docsage?"');
  const out = home.locator("#term-out");
  await expect(out).toContainText("── raio-x ──");
  // The index stems Portuguese, so the x-ray shows "funcion": the term the ranking actually used.
  await expect(out.locator(".t-token").first()).toHaveText("funcion");
  await expect(out).toContainText(/ranking BM25\s+\d+ candidatos, \d+ vão para o prompt/);
  await expect(out).toContainText("sem LLM neste ambiente");
});

test("ask --xray prices a replayed generation and shows the exact prompt", async ({ home }) => {
  const passage = {
    chunk: { id: "a#0", source: "docsage.md › O que é", text: "RAG" },
    score: 2,
    matchedTerms: ["rag"],
  };
  const done = {
    answer: "É um RAG.",
    passages: [passage],
    model: "claude-test",
    usage: { inputTokens: 1200, outputTokens: 300 },
    latencyMs: { retrieval: 1, generation: 3000 },
    degraded: null,
    xray: {
      terms: ["rag"],
      ranking: [
        { source: "docsage.md › O que é", score: 2, matchedTerms: ["rag"], kept: true },
        { source: "docsage.md › Stack", score: 0.5, matchedTerms: ["rag"], kept: false },
      ],
      prompt: { system: "Você responde perguntas", user: "<trecho>RAG</trecho>\n\nPergunta: rag?" },
      generation: { firstTokenMs: 800, tokensPerSecond: 100, costUsd: 0.0108 },
    },
  };
  await home.route("**/api/ask", (route) =>
    route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "x-ratelimit-remaining": "4", "x-ratelimit-limit": "5" },
      body: `event: done\ndata: ${JSON.stringify(done)}\n\n`,
    }),
  );
  await run(home, 'ask --xray "rag?"');
  const out = home.locator("#term-out");
  await expect(out.locator(".t-cut")).toContainText("docsage.md › Stack");
  await expect(out).toContainText("100 tokens/s");
  await expect(out).toContainText("~US$ 0.0108");
  const prompt = out.locator(".t-prompt");
  await prompt.locator("summary").click();
  await expect(prompt.locator("pre")).toContainText("Pergunta: rag?");
});

test("a second ask sends the first turn as a follow-up, and ask --new forgets it", async ({ home }) => {
  const bodies: { question: string; history?: { question: string; answer: string }[] }[] = [];
  const passage = { chunk: { id: "a#0", source: "docsage.md › O que é", text: "RAG" }, score: 2, matchedTerms: [] };
  await home.route("**/api/ask", (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    const done = {
      answer: `resposta ${bodies.length}`,
      passages: [passage],
      model: "claude-test",
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: { retrieval: 1, generation: 1 },
      degraded: null,
    };
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "x-ratelimit-remaining": "4", "x-ratelimit-limit": "5" },
      body: `event: done\ndata: ${JSON.stringify(done)}\n\n`,
    });
  });
  const out = home.locator("#term-out");
  await run(home, 'ask "o que é o docsage?"');
  await expect(out).toContainText("resposta 1");
  await run(home, 'ask "e a stack?"');
  await expect(out).toContainText("resposta 2");
  await expect(out).toContainText("follow-up: levo a pergunta anterior junto");
  await run(home, 'ask --new "outra coisa"');
  await expect(out).toContainText("resposta 3");

  expect(bodies[0]).not.toHaveProperty("history");
  expect(bodies[1].history).toEqual([{ question: "o que é o docsage?", answer: "resposta 1" }]);
  expect(bodies[2]).toEqual({ question: "outra coisa" });
});

test("/evals scores the real index and a question opens in the terminal", async ({ home }) => {
  await home.goto("/#/evals");
  const page = home.locator("#page-evals");
  await expect(page.locator("#evals-stats")).toContainText("recall@3");
  await expect(page.locator("#evals-state")).toContainText("engine local");
  // Only the local engine on this server, so there is nothing to switch between.
  await expect(page.locator("#evals-engines")).toBeHidden();
  expect(await page.locator("#evals-rows tr").count()).toBeGreaterThanOrEqual(20);

  await page.getByRole("button", { name: "o que é o docsage?" }).click();
  await expect(home.locator("#term-out")).toContainText("mostrando só a recuperação");
});

test("trace shows the waterfall of the answer it came from", async ({ home }) => {
  await run(home, 'ask "o que é o docsage?"');
  const out = home.locator("#term-out");
  await out.locator(".t-meta").last().getByRole("button", { name: "ver o trace" }).click();
  await expect(out).toContainText(/trace [0-9a-f]{16} · 200/);
  await expect(out).toContainText("POST /api/ask");
  await expect(out).toContainText("retrieve");
  await expect(out).toContainText("engine=local");
  // The waterfall is the widest thing the terminal prints; it must still fit at 375px.
  const overflow = await home.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("clicking a finished command opens the trace of its request", async ({ home }) => {
  await run(home, "status");
  const out = home.locator("#term-out");
  await expect(out).toContainText("uptime");
  await out.getByRole("button", { name: "ver o trace de status" }).click();
  await expect(out).toContainText(/trace [0-9a-f]{16} · 200/);
  await expect(out).toContainText("GET /api/status");
  // help never reaches the API, so its echo stays plain text.
  await run(home, "help");
  await expect(out.getByRole("button", { name: "ver o trace de help" })).toHaveCount(0);
});

test("kubectl get pods lays the cluster's pods out like kubectl", async ({ home }) => {
  // CI runs outside a cluster, so the API answer is replayed here; the command and table are real.
  await home.route("**/api/cluster/pods*", (route) =>
    route.fulfill({
      json: {
        namespace: "portfolio",
        readAt: "2026-10-17T12:00:00.000Z",
        pods: [
          {
            namespace: "portfolio",
            name: "portfolio-7d9f-abcde",
            phase: "Running",
            ready: "1/1",
            restarts: 0,
            node: "vps-1",
            startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
            cpuUsageMilli: 3,
            memoryUsageBytes: 64 * 2 ** 20,
          },
        ],
      },
    }),
  );
  await run(home, "kubectl get pods");
  const out = home.locator("#term-out");
  await expect(out).toContainText(/NAME\s+READY\s+STATUS\s+RESTARTS\s+AGE/);
  await expect(out).toContainText(/portfolio-7d9f-abcde\s+1\/1\s+Running\s+0\s+3h\s+3m\s+64Mi/);
  await expect(out).toContainText("cache de 5 s no servidor");
});

test("kubectl refuses anything but get, as the service account would", async ({ home }) => {
  await run(home, "kubectl delete pod portfolio");
  const out = home.locator("#term-out");
  await expect(out).toContainText("kubectl delete: proibido");
  await expect(out.getByRole("button", { name: "kubectl get pods" })).toBeVisible();
});

test("the cluster panel stays off outside a cluster", async ({ home }) => {
  await expect(home.locator("#cluster-note")).toContainText("não está rodando no k3s");
  await expect(home.locator("#cluster-pods-wrap")).toBeHidden();
});

test("the cluster panel shows the node against its capacity and every visible pod", async ({ home }) => {
  // Replayed: CI has no cluster. The status keeps the real server's fields and only turns the cluster on.
  await home.route("**/api/status", async (route) => {
    const res = await route.fetch();
    route.fulfill({ response: res, json: { ...(await res.json()), cluster: { namespaces: ["portfolio"] } } });
  });
  await home.route("**/api/cluster", (route) =>
    route.fulfill({
      json: {
        namespaces: ["portfolio"],
        readAt: new Date().toISOString(),
        nodes: [
          {
            name: "vps-1",
            ready: true,
            kubeletVersion: "v1.33.4+k3s1",
            createdAt: "2026-09-01T00:00:00Z",
            cpuCapacityMilli: 2000,
            memoryCapacityBytes: 4 * 2 ** 30,
            cpuUsageMilli: 410,
            memoryUsageBytes: 2 ** 30,
          },
        ],
        pods: [
          {
            namespace: "portfolio",
            name: "portfolio-7d9f-abcde",
            phase: "Running",
            ready: "1/1",
            restarts: 1,
            node: "vps-1",
            startedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
            cpuUsageMilli: 3,
            memoryUsageBytes: 64 * 2 ** 20,
          },
        ],
      },
    }),
  );
  await home.reload();
  await expect(home.locator("#cluster-note")).toContainText("namespaces portfolio · só leitura");
  await expect(home.locator("#cluster-nodes")).toContainText("410m de 2000m (21%)");
  await expect(home.locator("#cluster-nodes")).toContainText("1.0Gi de 4.0Gi (25%)");
  const row = home.locator("#cluster-pods tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("portfolio/portfolio-7d9f-abcde");
  await expect(row).toContainText("2d");
});

test("ratelimit empties the lab bucket on the server and reads it back from the headers", async ({ page }) => {
  // Its own setup: the 429s are the point here, so only errors outside the lab's endpoint fail it.
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("response", (res) => {
    const { pathname } = new URL(res.url());
    if (res.status() >= 400 && !(res.status() === 429 && pathname === "/api/lab/ratelimit"))
      errors.push(`${res.status()} ${pathname}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("429")) errors.push(msg.text());
  });
  await page.goto("/");
  await run(page, "ratelimit");
  const out = page.locator("#term-out");
  await expect(out).toContainText("um balde de tokens só seu");
  // Both projects share this address and the bucket holds ten: twenty shots always reach a 429.
  await out.getByRole("button", { name: "dispara 10" }).click();
  await expect(out).toContainText("x-ratelimit-remaining:");
  await expect(out).toContainText(/\d+ aceitos, \d+ recusados com 429/);
  await run(page, "ratelimit 10");
  await expect(out.locator(".t-line", { hasText: "retry-after:" }).first()).toBeVisible();
  await expect(out.locator(".t-line", { hasText: /aceitos/ })).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("man lists its pages and says which commands this server cannot run", async ({ page }) => {
  // Its own setup: `man rm` is supposed to 404, so only errors outside the manual fail this one.
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("response", (res) => {
    const { pathname } = new URL(res.url());
    if (res.status() >= 400 && !(res.status() === 404 && pathname.startsWith("/api/man/")))
      errors.push(`${res.status()} ${pathname}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("404")) errors.push(msg.text());
  });
  await page.goto("/");
  const out = page.locator("#term-out");

  await run(page, "man");
  await expect(out).toContainText("as páginas deste manual");
  // No STUN sockets and no cluster in this run, so their pages say so instead of inviting a click.
  await expect(out.locator(".t-line", { hasText: "como o seu NAT te mapeia" })).toContainText("desligado aqui");

  await out.getByRole("button", { name: "manual de ask" }).click();
  await expect(out).toContainText("SINOPSE");
  await expect(out).toContainText("--xray");
  await expect(out).toContainText("VEJA TAMBÉM");
  // No LLM key here either: the ask page is honest about what it can do on this server.
  await expect(out).toContainText("desligado neste servidor");

  await run(page, "man rm");
  await expect(out).toContainText('não há página de manual para "rm"');
  expect(errors).toEqual([]);
});
