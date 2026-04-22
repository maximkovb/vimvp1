import { describe, it, expect } from "vitest";
import { Outcome, formatOutcome, isYes } from "../constants";

describe("Outcome encoding (0=YES, 1=NO)", () => {
  describe("Outcome constants", () => {
    it("YES is 0", () => {
      expect(Outcome.YES).toBe(0);
    });

    it("NO is 1", () => {
      expect(Outcome.NO).toBe(1);
    });
  });

  describe("formatOutcome()", () => {
    it("returns 'YES' for outcome 0", () => {
      expect(formatOutcome(0)).toBe("YES");
    });

    it("returns 'NO' for outcome 1", () => {
      expect(formatOutcome(1)).toBe("NO");
    });

    it("throws for unexpected values", () => {
      expect(() => formatOutcome(2)).toThrow();
      expect(() => formatOutcome(-1)).toThrow();
    });
  });

  describe("isYes()", () => {
    it("returns true for outcome 0 (YES)", () => {
      expect(isYes(0)).toBe(true);
    });

    it("returns false for outcome 1 (NO)", () => {
      expect(isYes(1)).toBe(false);
    });
  });
});
