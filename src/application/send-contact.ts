import { randomUUID } from "node:crypto";
import type { ContactMessage, Mailer } from "../domain/contact.js";

export class ContactDisabledError extends Error {}
export class ContactBudgetError extends Error {}

/**
 * Forwards a contact message through the mailer. Per-visitor limits live in the HTTP layer;
 * this adds a global daily cap, so a burst from many IPs still can't flood the inbox or the provider.
 */
export class SendContact {
  private day = "";
  private sentToday = 0;

  constructor(
    private readonly mailer: Mailer | null,
    private readonly dailyCap = 30,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => string = () => `msg_${randomUUID().slice(0, 8)}`,
  ) {}

  get enabled(): boolean {
    return this.mailer !== null;
  }

  async execute(message: ContactMessage): Promise<{ id: string }> {
    if (!this.mailer) throw new ContactDisabledError("contato desligado");
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.sentToday = 0;
    }
    if (this.sentToday >= this.dailyCap) throw new ContactBudgetError("limite diário de mensagens atingido");

    const id = this.newId();
    await this.mailer.send({ ...message, id });
    this.sentToday++;
    return { id };
  }
}
