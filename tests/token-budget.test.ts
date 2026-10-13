import { describe, expect, it } from "vitest";
import { DailyTokenBudget } from "../src/infrastructure/llm/daily-token-budget.js";

const NOON = Date.UTC(2026, 9, 13, 12);

describe("DailyTokenBudget", () => {
  it("allows spending until the limit is reached", () => {
    const budget = new DailyTokenBudget(1000, () => NOON);
    expect(budget.canSpend()).toBe(true);
    budget.charge(600);
    expect(budget.canSpend()).toBe(true);
    budget.charge(600);
    expect(budget.canSpend()).toBe(false);
    expect(budget.usage()).toEqual({
      limit: 1000,
      used: 1200,
      remaining: 0,
      resetsAt: "2026-10-14T00:00:00.000Z",
    });
  });

  it("starts over at midnight UTC", () => {
    let now = NOON;
    const budget = new DailyTokenBudget(100, () => now);
    budget.charge(100);
    expect(budget.canSpend()).toBe(false);
    now = Date.UTC(2026, 9, 14, 0, 0, 1);
    expect(budget.canSpend()).toBe(true);
    expect(budget.usage().used).toBe(0);
    expect(budget.usage().resetsAt).toBe("2026-10-15T00:00:00.000Z");
  });

  it("ignores negative charges", () => {
    const budget = new DailyTokenBudget(100, () => NOON);
    budget.charge(-50);
    expect(budget.usage().used).toBe(0);
  });
});
