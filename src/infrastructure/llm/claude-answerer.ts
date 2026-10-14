import Anthropic from "@anthropic-ai/sdk";
import type { AnswerOptions, Answerer, Generation } from "../../domain/answer.js";
import type { Hit } from "../../domain/search.js";

const SYSTEM_PROMPT = `Você responde perguntas sobre o portfólio de um desenvolvedor, em nome dele, no site pessoal.
Use apenas os trechos fornecidos. Se a resposta não estiver neles, diga que não sabe e sugira entrar em contato.
Responda na língua da pergunta, em no máximo 4 frases, e cite as fontes entre colchetes, como [docsage.md › O que é].
Trechos marcados com TODO ainda não foram escritos: trate-os como ausentes.`;

export const REFUSAL_TEXT = "Não consigo responder isso aqui.";

export class ClaudeAnswerer implements Answerer {
  constructor(
    private readonly client = new Anthropic(),
    readonly model = process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
  ) {}

  async answer(question: string, passages: Hit[], { onText, signal }: AnswerOptions = {}): Promise<Generation> {
    const context = passages.map((p) => `<trecho fonte="${p.chunk.source}">\n${p.chunk.text}\n</trecho>`).join("\n");

    // Always streamed: the same call serves the JSON route (no onText) and the SSE one.
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: 1024,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `${context}\n\nPergunta: ${question}` }],
      },
      { signal },
    );
    if (onText) stream.on("text", (delta) => onText(delta));
    const response = await stream.finalMessage();

    // A refusal can arrive after some text was streamed; the final text replaces it on the client.
    const text =
      response.stop_reason === "refusal"
        ? REFUSAL_TEXT
        : response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

    return { text, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
  }
}
