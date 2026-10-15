export interface ModelPrice {
  inputPerMTok: number; // US$ per million input tokens
  outputPerMTok: number; // US$ per million output tokens, thinking included
}

/** What a model costs per token, so the x-ray can put a price on an answer. */
export interface PriceList {
  priceOf(model: string): ModelPrice | null;
}

export function costUsd({ inputPerMTok, outputPerMTok }: ModelPrice, inputTokens: number, outputTokens: number) {
  return (inputTokens * inputPerMTok + outputTokens * outputPerMTok) / 1_000_000;
}
