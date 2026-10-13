export type ContactReason = "vaga" | "projeto" | "conversa";

export interface ContactMessage {
  reason: ContactReason;
  name: string;
  email: string;
  message: string;
}

/** Delivers a visitor's message to the owner. */
export interface Mailer {
  send(message: ContactMessage & { id: string }): Promise<void>;
}
