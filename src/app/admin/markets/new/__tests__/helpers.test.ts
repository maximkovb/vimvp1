import { describe, it, expect } from "vitest";
import { computeStep, computeMilestoneFloor } from "../helpers";

describe("computeStep", () => {
  // formula: 10^(floor(log10(anchor)) - 1)
  // anchor=100000 → 10^(5-1) = 10000 (1/10th of the anchor's order of magnitude)
  it("returns 10000 for anchor=100000", () => {
    expect(computeStep(100000)).toBe(10000);
  });

  it("returns 100 for anchor=1000", () => {
    expect(computeStep(1000)).toBe(100);
  });

  it("returns 1 for anchor=10 (min clamp)", () => {
    expect(computeStep(10)).toBe(1);
  });

  it("returns 1 for anchor=1 (min clamp)", () => {
    expect(computeStep(1)).toBe(1);
  });

  it("returns 1 for anchor=0 (guards against log10(0) = -Infinity)", () => {
    expect(computeStep(0)).toBe(1);
  });
});

describe("computeMilestoneFloor", () => {
  it("uses 0.1× anchor when current analytics floor is lower", () => {
    // anchor=100000, current=0 → floor = max(10000, 0) = 10000
    expect(computeMilestoneFloor(100_000, 0)).toBe(10_000);
  });

  it("uses 1.2× current analytics when it exceeds 0.1× anchor", () => {
    // anchor=100000 (0.1× = 10000), current=50000 (1.2× = 60000) → floor = 60000
    expect(computeMilestoneFloor(100_000, 50_000)).toBe(60_000);
  });

  it("exactly 0.1× anchor ties with 1.2× current — anchor wins as lower bound", () => {
    // anchor=100000 (0.1× = 10000), current=8333 (1.2× = 9999.6 → ceil = 10000) → floor = 10000
    expect(computeMilestoneFloor(100_000, 8_333)).toBe(10_000);
  });

  it("zero analytics falls back to 0.1× anchor", () => {
    expect(computeMilestoneFloor(500_000, 0)).toBe(50_000);
  });
});
