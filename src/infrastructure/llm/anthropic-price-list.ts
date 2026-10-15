import type { ModelPrice, PriceList } from "../../domain/pricing.js";

// First-party API list prices (US$ per million tokens), checked 2026-10. An estimate: cache reads
// and fallback reruns on another model are not priced in.
const PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
};

export class AnthropicPriceList implements PriceList {
  constructor(private readonly prices: Record<string, ModelPrice> = PRICES) {}

  priceOf(model: string): ModelPrice | null {
    return this.prices[model] ?? null;
  }
}
