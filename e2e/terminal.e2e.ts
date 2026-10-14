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
