import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { ReportStatus } from "../src/application/report-status.js";
import { ContactBudgetError, ContactDisabledError, SendContact } from "../src/application/send-contact.js";
import type { ContactMessage, Mailer } from "../src/domain/contact.js";
import type { Content } from "../src/domain/content.js";
import type { Logger } from "../src/domain/logger.js";
import { createApp } from "../src/http/app.js";
import { ResendMailer } from "../src/infrastructure/mail/resend-mailer.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";

const message: ContactMessage = {
  reason: "vaga",
  name: "Ana Souza",
  email: "ana@exemplo.com",
  message: "Oi! Vi o portfólio e queria conversar sobre uma vaga.",
};

class RecordingMailer implements Mailer {
  sent: (ContactMessage & { id: string })[] = [];
  async send(m: ContactMessage & { id: string }) {
    this.sent.push(m);
  }
}

describe("SendContact", () => {
  it("is disabled without a mailer", async () => {
    const send = new SendContact(null);
    expect(send.enabled).toBe(false);
    await expect(send.execute(message)).rejects.toBeInstanceOf(ContactDisabledError);
  });

  it("caps messages per day and resets the next day", async () => {
    let now = new Date("2026-10-13T10:00:00Z");
    const mailer = new RecordingMailer();
    const send = new SendContact(mailer, 2, () => now);
    await send.execute(message);
    await send.execute(message);
    await expect(send.execute(message)).rejects.toBeInstanceOf(ContactBudgetError);
    now = new Date("2026-10-14T00:01:00Z");
    await expect(send.execute(message)).resolves.toHaveProperty("id");
    expect(mailer.sent).toHaveLength(3);
  });
});

describe("ResendMailer", () => {
  it("posts the message with the visitor as reply-to", async () => {
    const calls: [string, RequestInit][] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await new ResendMailer("re_test", "dono@exemplo.com", undefined, fakeFetch).send({ ...message, id: "msg_1" });

    const [url, init] = calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ to: ["dono@exemplo.com"], reply_to: "ana@exemplo.com" });
    expect(body.subject).toBe("[portfólio] Vaga · Ana Souza");
    expect(body.text).toContain("msg_1");
  });

  it("fails when the provider refuses", async () => {
    const fakeFetch = (async () => new Response("no", { status: 422 })) as unknown as typeof fetch;
    await expect(new ResendMailer("k", "t", undefined, fakeFetch).send({ ...message, id: "x" })).rejects.toThrow(/422/);
  });
});

describe("POST /api/contact", () => {
  const content: Content = {
    profile: { name: "N", handle: "n", role: "r", links: {}, body: "" },
    projects: [],
    skills: [],
  };
  const silent: Logger = { info: () => {}, error: () => {} };
  const servers: Server[] = [];

  async function start(mailer: Mailer | null) {
    const metrics = new InMemoryMetrics();
    const app = createApp({
      browse: new BrowsePortfolio(content),
      askQuestion: new AskQuestion({ search: () => [] }, null),
      reportStatus: new ReportStatus(metrics, null, new SampledHistory(metrics)),
      sendContact: new SendContact(mailer),
      inspectVisitor: new InspectVisitor([], { lookup: async () => null }),
      metrics,
      logger: silent,
      publicDir: path.resolve(import.meta.dirname, "..", "public"),
    });
    const server = app.listen(0);
    servers.push(server);
    await new Promise((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (body: unknown) =>
      fetch(`${base}/api/contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    return { base, post };
  }

  let mailer: RecordingMailer;
  let on: Awaited<ReturnType<typeof start>>;
  let off: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    mailer = new RecordingMailer();
    on = await start(mailer);
    off = await start(null);
  });
  afterAll(() => servers.forEach((s) => s.close()));

  it("tells the page whether the form is on", async () => {
    expect(await (await fetch(`${on.base}/api/contact`)).json()).toEqual({ enabled: true, perHour: 3 });
    expect(await (await fetch(`${off.base}/api/contact`)).json()).toEqual({ enabled: false, perHour: 3 });
    expect((await off.post(message)).status).toBe(503);
  });

  it("rejects invalid input, including a name that would break the subject line", async () => {
    expect((await on.post({ ...message, email: "nope" })).status).toBe(400);
    expect((await on.post({ ...message, message: "curta" })).status).toBe(400);
    expect((await on.post({ ...message, name: "Ana\nBcc: x@y.z" })).status).toBe(400);
  });

  it("accepts a message, then rate limits the visitor to 3 per hour", async () => {
    const first = await on.post(message);
    expect(first.status).toBe(202);
    expect((await first.json()).id).toMatch(/^msg_/);
    expect(mailer.sent[0]).toMatchObject({ name: "Ana Souza", reason: "vaga" });

    const honeypot = await on.post({ ...message, website: "http://spam" });
    expect(honeypot.status).toBe(202);
    expect(mailer.sent).toHaveLength(1);

    expect((await on.post(message)).status).toBe(202);
    expect((await on.post(message)).status).toBe(429);
  });
});
