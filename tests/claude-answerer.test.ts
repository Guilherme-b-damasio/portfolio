import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { Hit } from "../src/domain/search.js";
import { ClaudeAnswerer, REFUSAL_TEXT } from "../src/infrastructure/llm/claude-answerer.js";

const hit: Hit = { chunk: { id: "a.md#1", source: "a.md › Intro", text: "texto" }, score: 1, matchedTerms: [] };

/** Stands in for client.beta.messages.stream: replays the deltas, then resolves the final message. */
function fakeClient(deltas: string[], stopReason = "end_turn") {
  const calls: { params: Record<string, unknown>; options: { signal?: AbortSignal } }[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>, options: { signal?: AbortSignal }) {
          calls.push({ params, options });
          const listeners: ((delta: string) => void)[] = [];
          return {
            on(event: string, listener: (delta: string) => void) {
              if (event === "text") listeners.push(listener);
              return this;
            },
            async finalMessage() {
              for (const d of deltas) listeners.forEach((l) => l(d));
              return {
                stop_reason: stopReason,
                content: [{ type: "text", text: deltas.join("") }],
                usage: { input_tokens: 11, output_tokens: deltas.length },
              };
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

describe("ClaudeAnswerer", () => {
  it("streams the answer through onText and returns the whole text with usage", async () => {
    const { client, calls } = fakeClient(["Olá", ", ", "mundo"]);
    const seen: string[] = [];
    const signal = new AbortController().signal;
    const out = await new ClaudeAnswerer(client, "m").answer("oi?", [hit], { onText: (d) => seen.push(d), signal });

    expect(seen).toEqual(["Olá", ", ", "mundo"]);
    expect(out).toEqual({ text: "Olá, mundo", inputTokens: 11, outputTokens: 3 });
    expect(calls[0].options.signal).toBe(signal);
    expect(calls[0].params).toMatchObject({
      model: "m",
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
    });
    expect(calls[0].params).not.toHaveProperty("thinking");
  });

  it("works without a listener, for the plain JSON route", async () => {
    const { client } = fakeClient(["ok"]);
    expect((await new ClaudeAnswerer(client, "m").answer("oi?", [hit])).text).toBe("ok");
  });

  it("sends exactly the prompt it shows to the x-ray", async () => {
    const { client, calls } = fakeClient(["ok"]);
    const answerer = new ClaudeAnswerer(client, "m");
    await answerer.answer("oi?", [hit]);
    const { system, user } = answerer.prompt("oi?", [hit]);

    expect(user).toBe('<trecho fonte="a.md › Intro">\ntexto\n</trecho>\n\nPergunta: oi?');
    expect(calls[0].params.system).toBe(system);
    expect(calls[0].params.messages).toEqual([{ role: "user", content: user }]);
  });

  it("replaces a refused answer with a fixed line", async () => {
    const { client } = fakeClient(["meio"], "refusal");
    expect((await new ClaudeAnswerer(client, "m").answer("oi?", [hit])).text).toBe(REFUSAL_TEXT);
  });
});
