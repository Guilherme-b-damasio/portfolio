import type { ContactMessage, Mailer } from "../../domain/contact.js";

const REASONS = { vaga: "Vaga", projeto: "Projeto", conversa: "Conversa" } as const;

/** Sends through Resend's HTTP API with plain fetch: no SDK, nothing extra in the image. */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly to: string,
    private readonly from = "Portfólio <onboarding@resend.dev>",
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(message: ContactMessage & { id: string }): Promise<void> {
    const res = await this.fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [this.to],
        reply_to: message.email,
        subject: `[portfólio] ${REASONS[message.reason]} · ${message.name}`,
        text: `${message.message}\n\n--\n${message.name} <${message.email}>\nassunto: ${message.reason}\nid: ${message.id}`,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`resend respondeu ${res.status}`);
  }
}
