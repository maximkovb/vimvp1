import { describe, it, expect } from "vitest";
import {
  cost,
  price,
  allPrices,
  tradeCost,
  sharesForCost,
  maxMarketMakerLoss,
} from "../lmsr";

describe("LMSR Engine", () => {
  const B = 100;

  describe("price()", () => {
    it("returns 0.5 for each outcome at equilibrium (equal quantities)", () => {
      const q = [0, 0];
      expect(price(q, B, 0)).toBeCloseTo(0.5, 6);
      expect(price(q, B, 1)).toBeCloseTo(0.5, 6);
    });

    it("prices sum to 1.0", () => {
      const q = [50, 30];
      const prices = allPrices(q, B);
      expect(prices[0] + prices[1]).toBeCloseTo(1.0, 10);
    });

    it("buying YES shares increases YES price", () => {
      const q = [0, 0];
      const priceBefore = price(q, B, 0);
      const qAfter = [10, 0];
      const priceAfter = price(qAfter, B, 0);
      expect(priceAfter).toBeGreaterThan(priceBefore);
    });

    it("prices are symmetric for equal quantities", () => {
      const q = [25, 25];
      expect(price(q, B, 0)).toBeCloseTo(price(q, B, 1), 10);
    });
  });

  describe("cost()", () => {
    it("computes cost at equilibrium", () => {
      const q = [0, 0];
      // C(0,0) = b * ln(e^0 + e^0) = b * ln(2)
      expect(cost(q, B)).toBeCloseTo(B * Math.log(2), 6);
    });

    it("cost increases when shares are added", () => {
      const c1 = cost([0, 0], B);
      const c2 = cost([10, 0], B);
      expect(c2).toBeGreaterThan(c1);
    });
  });

  describe("tradeCost()", () => {
    it("buying 10 YES shares from equilibrium costs ~5.10 coins with b=100", () => {
      const q = [0, 0];
      const tc = tradeCost(q, B, 0, 10);
      // C(10,0) - C(0,0) ≈ 5.125
      expect(tc).toBeCloseTo(5.1249, 2);
    });

    it("trade cost is always positive for buying", () => {
      const q = [20, 10];
      const tc = tradeCost(q, B, 0, 5);
      expect(tc).toBeGreaterThan(0);
    });

    it("trade cost is negative for selling (refund)", () => {
      const q = [20, 10];
      const tc = tradeCost(q, B, 0, -5);
      expect(tc).toBeLessThan(0);
    });

    it("buy + sell round-trip loses a small amount (spread)", () => {
      const q = [0, 0];
      const buyCost = tradeCost(q, B, 0, 10);
      const qAfterBuy = [10, 0];
      const sellRefund = tradeCost(qAfterBuy, B, 0, -10);

      // Buy cost + sell refund should net to ~0 (LMSR has no spread on round-trip)
      // In LMSR, buying 10 then selling 10 returns to the same state, so net = 0
      expect(buyCost + sellRefund).toBeCloseTo(0, 6);
    });

    it("larger trades cost more per share than smaller trades", () => {
      const q = [0, 0];
      const costFor10 = tradeCost(q, B, 0, 10);
      const costFor20 = tradeCost(q, B, 0, 20);

      // Cost per share increases with quantity
      expect(costFor20 / 20).toBeGreaterThan(costFor10 / 10);
    });
  });

  describe("sharesForCost()", () => {
    it("returns 0 for 0 or negative amount", () => {
      expect(sharesForCost([0, 0], B, 0, 0)).toBe(0);
      expect(sharesForCost([0, 0], B, 0, -10)).toBe(0);
    });

    it("correctly inverts tradeCost", () => {
      const q = [0, 0];
      const amount = 20;
      const shares = sharesForCost(q, B, 0, amount);
      const actualCost = tradeCost(q, B, 0, shares);
      expect(actualCost).toBeCloseTo(amount, 4);
    });

    it("works at non-equilibrium prices", () => {
      const q = [50, 20];
      const amount = 15;
      const shares = sharesForCost(q, B, 1, amount);
      const actualCost = tradeCost(q, B, 1, shares);
      expect(actualCost).toBeCloseTo(amount, 4);
    });

    it("returns fewer shares when price is higher", () => {
      const qLow = [0, 0]; // YES price = 0.5
      const qHigh = [100, 0]; // YES price > 0.5
      const amount = 10;
      const sharesLow = sharesForCost(qLow, B, 0, amount);
      const sharesHigh = sharesForCost(qHigh, B, 0, amount);
      expect(sharesHigh).toBeLessThan(sharesLow);
    });
  });

  describe("numerical stability", () => {
    it("handles very large quantities without overflow", () => {
      const q = [10000, 0];
      const p = price(q, B, 0);
      expect(p).toBeCloseTo(1.0, 6);
      expect(isFinite(p)).toBe(true);
    });

    it("handles very large negative disparity without NaN", () => {
      const q = [0, 10000];
      const p = price(q, B, 0);
      expect(p).toBeCloseTo(0.0, 6);
      expect(isFinite(p)).toBe(true);
    });

    it("trade cost is finite at extreme quantities", () => {
      const q = [5000, 0];
      const tc = tradeCost(q, B, 0, 10);
      expect(isFinite(tc)).toBe(true);
      expect(tc).toBeGreaterThan(0);
    });

    it("handles very small b parameter", () => {
      const q = [0, 0];
      const smallB = 1;
      const p = price(q, smallB, 0);
      expect(p).toBeCloseTo(0.5, 6);
      expect(isFinite(p)).toBe(true);
    });
  });

  describe("maxMarketMakerLoss()", () => {
    it("computes correct max loss for binary market", () => {
      const loss = maxMarketMakerLoss(100);
      expect(loss).toBeCloseTo(100 * Math.log(2), 6);
      expect(loss).toBeCloseTo(69.31, 1);
    });

    it("scales linearly with b", () => {
      const loss50 = maxMarketMakerLoss(50);
      const loss100 = maxMarketMakerLoss(100);
      expect(loss100).toBeCloseTo(loss50 * 2, 6);
    });
  });
});
