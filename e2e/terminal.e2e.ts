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
  await expect(out.locator(".t-token").first()).toHaveText("funciona");
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
