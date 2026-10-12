import Anthropic from "@anthropic-ai/sdk";
import type { Hit, Retriever } from "./search.js";

export interface AskResult {
  answer: string | null; // null when no LLM is configured: the passages are the answer
  passages: Hit[];
  model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  latencyMs: { retrieval: number; generation: number | null };
}

export interface Answerer {
  readonly model: string;
  answer(question: string, passages: Hit[]): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

const SYSTEM_PROMPT = `Você responde perguntas sobre o portfólio de um desenvolvedor, em nome dele, no site pessoal.
Use apenas os trechos fornecidos. Se a resposta não estiver neles, diga que não sabe e sugira entrar em contato.
Responda na língua da pergunta, em no máximo 4 frases, e cite as fontes entre colchetes, como [docsage.md › O que é].
Trechos marcados com TODO ainda não foram escritos: trate-os como ausentes.`;

export class ClaudeAnswerer implements Answerer {
  constructor(
    private readonly client = new Anthropic(),
    readonly model = process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  ) {}

  async answer(question: string, passages: Hit[]) {
    const context = passages.map((p) => `<trecho fonte="${p.chunk.source}">\n${p.chunk.text}\n</trecho>`).join("\n");

    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${context}\n\nPergunta: ${question}` }],
    });

    const text =
      response.stop_reason === "refusal"
        ? "Não consigo responder isso aqui."
        : response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

    return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  }
}

export async function ask(question: string, retriever: Retriever, answerer: Answerer | null): Promise<AskResult> {
  const t0 = performance.now();
  const passages = await retriever.search(question, 4);
  const retrieval = performance.now() - t0;

  if (!answerer || passages.length === 0) {
    return { answer: null, passages, model: null, usage: null, latencyMs: { retrieval, generation: null } };
  }

  const t1 = performance.now();
  const { text, inputTokens, outputTokens } = await answerer.answer(question, passages);
  return {
    answer: text,
    passages,
    model: answerer.model,
    usage: { inputTokens, outputTokens },
    latencyMs: { retrieval, generation: performance.now() - t1 },
  };
}
