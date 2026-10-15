import { describe, expect, it } from "vitest";
import { costUsd } from "../src/domain/pricing.js";
import { AnthropicPriceList } from "../src/infrastructure/llm/anthropic-price-list.js";

describe("AnthropicPriceList", () => {
  it("prices the default model and knows nothing about unlisted ones", () => {
    const prices = new AnthropicPriceList();
    expect(prices.priceOf("claude-opus-5-5")).toEqual({ inputPerMTok: 4, outputPerMTok: 20 });
    expect(prices.priceOf("gpt-x")).toBeNull();
  });

  it("turns token counts into dollars", () => {
    // 1 200 in at $4/M + 300 out at $20/M = 0.0048 + 0.006
    expect(costUsd({ inputPerMTok: 4, outputPerMTok: 20 }, 1200, 300)).toBeCloseTo(0.0108, 10);
  });
});
