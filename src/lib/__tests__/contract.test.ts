import { describe, it, expect } from "vitest";
import {
  assignRiskTier,
  calculateConfidence,
  roundToClean,
  resolveWindow,
  calculateContractRecommendations,
} from "../contract";
import {
  projectVelocity,
  channelAvgAtHorizon,
  computeExpectedOutcome,
  computeCalibrationProbability,
} from "../calibration";

describe("assignRiskTier()", () => {
  it("returns 'low' at and above 70", () => {
    expect(assignRiskTier(70)).toBe("low");
    expect(assignRiskTier(100)).toBe("low");
  });

  it("returns 'medium' between 40 and 69 inclusive", () => {
    expect(assignRiskTier(40)).toBe("medium");
    expect(assignRiskTier(69)).toBe("medium");
    expect(assignRiskTier(55)).toBe("medium");
  });

  it("returns 'high' below 40", () => {
    expect(assignRiskTier(39)).toBe("high");
    expect(assignRiskTier(0)).toBe("high");
  });
});

describe("calculateConfidence()", () => {
  it("returns max score for perfectly consistent channel in sweet-spot age", () => {
    // All same views → stdDev=0 → varianceScore=1; age 6h is in sweet spot → ageScore=1
    const score = calculateConfidence(6, [500_000, 500_000, 500_000]);
    expect(score).toBe(100);
  });

  it("applies 0.6 age penalty outside the 2–12h sweet spot", () => {
    const inSweet = calculateConfidence(6, [500_000, 500_000, 500_000]);
    const outSweet = calculateConfidence(24, [500_000, 500_000, 500_000]);
    expect(inSweet).toBe(100);
    expect(outSweet).toBe(60); // 1.0 * 0.6 * 100
  });

  it("returns 0 for a maximally chaotic channel in sweet-spot age", () => {
    // stdDev ≥ mean → varianceScore clamped to 0
    const score = calculateConfidence(6, [0, 1_000_000]);
    expect(score).toBe(0);
  });

  it("uses precomputed mean/stdDev when provided", () => {
    const recentViews = [400_000, 600_000];
    const mean = 500_000;
    const variance = ((400_000 - mean) ** 2 + (600_000 - mean) ** 2) / 2;
    const stdDev = Math.sqrt(variance);

    const withPrecomputed = calculateConfidence(6, recentViews, mean, stdDev);
    const withArray = calculateConfidence(6, recentViews);
    expect(withPrecomputed).toBe(withArray);
  });

  it("defaults varianceScore to 0.5 for a single-element array (no variance data)", () => {
    const score = calculateConfidence(6, [500_000]);
    // varianceScore=0.5 (default), ageScore=1.0 → 50
    expect(score).toBe(50);
  });

  it("defaults varianceScore to 0.5 for an empty array", () => {
    const score = calculateConfidence(6, []);
    expect(score).toBe(50);
  });
});

describe("roundToClean()", () => {
  it("rounds to nearest 1,000 below 10k", () => {
    expect(roundToClean(4_500)).toBe(5_000);
    expect(roundToClean(9_999)).toBe(10_000);
    expect(roundToClean(1_200)).toBe(1_000);
  });

  it("rounds to nearest 5,000 in 10k–100k range", () => {
    expect(roundToClean(10_000)).toBe(10_000);
    expect(roundToClean(12_000)).toBe(10_000);
    expect(roundToClean(97_500)).toBe(100_000);
    expect(roundToClean(99_999)).toBe(100_000);
  });

  it("rounds to nearest 10,000 in 100k–500k range", () => {
    expect(roundToClean(100_000)).toBe(100_000);
    expect(roundToClean(145_000)).toBe(150_000);
    expect(roundToClean(499_999)).toBe(500_000);
  });

  it("rounds to nearest 50,000 in 500k–2M range", () => {
    expect(roundToClean(500_000)).toBe(500_000);
    expect(roundToClean(725_000)).toBe(750_000);
    expect(roundToClean(1_999_999)).toBe(2_000_000);
  });

  it("rounds to nearest 100,000 at and above 2M", () => {
    expect(roundToClean(2_000_000)).toBe(2_000_000);
    expect(roundToClean(5_450_000)).toBe(5_500_000);
    expect(roundToClean(10_000_001)).toBe(10_000_000);
  });
});

describe("resolveWindow()", () => {
  it("returns 24h for a fresh video (< 20h old)", () => {
    expect(resolveWindow(0)).toBe(24);
    expect(resolveWindow(10)).toBe(24);
    expect(resolveWindow(19.9)).toBe(24);
  });

  it("returns 48h when video is 20–43h old", () => {
    expect(resolveWindow(20)).toBe(48);
    expect(resolveWindow(30)).toBe(48);
    expect(resolveWindow(43.9)).toBe(48);
  });

  it("returns 72h when video is 44h or older", () => {
    expect(resolveWindow(44)).toBe(72);
    expect(resolveWindow(48)).toBe(72);
    expect(resolveWindow(100)).toBe(72);
  });

  it("returns 72h as the default for old videos", () => {
    expect(resolveWindow(48)).toBe(72);
    expect(resolveWindow(50)).toBe(72);
  });

  it("resolutionHours is always a valid value (24, 48, or 72)", () => {
    const valid = new Set([24, 48, 72]);
    for (const confidence of [80, 55, 20]) {
      const result = calculateContractRecommendations(
        confidence,
        500_000,
        10,
        Array(10).fill(1_000_000)
      );
      expect(valid.has(result.resolutionHours)).toBe(true);
    }
  });
});

// ── calibration.ts unit tests ─────────────────────────────────────────────────

describe("projectVelocity()", () => {
  it("projects forward from current velocity using logarithmic growth", () => {
    // 100K views at 10h → project to 24h
    const p = projectVelocity(100_000, 10, 24);
    const expected = Math.round(100_000 * (Math.log(25) / Math.log(11)));
    expect(p).toBe(expected);
  });

  it("clamps video age to 0.1 to avoid log(0)", () => {
    expect(() => projectVelocity(100_000, 0, 24)).not.toThrow();
    expect(projectVelocity(100_000, 0, 24)).toBeGreaterThan(0);
  });
});

describe("channelAvgAtHorizon()", () => {
  it("returns 55% of channel avg for 24h window", () => {
    expect(channelAvgAtHorizon(400_000, 24)).toBe(Math.round(400_000 * 0.55));
  });

  it("returns 80% of channel avg for 48h window", () => {
    expect(channelAvgAtHorizon(400_000, 48)).toBe(Math.round(400_000 * 0.8));
  });

  it("returns 100% of channel avg for 72h window", () => {
    expect(channelAvgAtHorizon(400_000, 72)).toBe(400_000);
  });
});

describe("computeExpectedOutcome()", () => {
  it("returns channel baseline when it exceeds velocity projection", () => {
    // Channel avg 400K, video only has 30K views at 2h old — velocity is slow
    // channelAvgAtHorizon(400K, 72) = 400K; velocity projection will be much lower
    const velocity = projectVelocity(30_000, 2, 72);
    const channelFloor = channelAvgAtHorizon(400_000, 72); // 400K
    const expected = computeExpectedOutcome(30_000, 2, 72, 400_000);
    expect(expected).toBe(Math.max(velocity, channelFloor));
    expect(expected).toBe(channelFloor); // channel floor dominates
  });

  it("returns velocity projection when it exceeds channel baseline", () => {
    // Trending video: 1M views at 5h on a 50K avg channel
    const velocity = projectVelocity(1_000_000, 5, 24);
    const channelFloor = channelAvgAtHorizon(50_000, 24); // 27.5K
    const expected = computeExpectedOutcome(1_000_000, 5, 24, 50_000);
    expect(expected).toBe(Math.max(velocity, channelFloor));
    expect(expected).toBe(velocity); // velocity dominates
  });

  it("degrades to velocity-only when channelAvgViews is 0", () => {
    const velocity = projectVelocity(200_000, 6, 48);
    const expected = computeExpectedOutcome(200_000, 6, 48, 0);
    expect(expected).toBe(velocity);
  });
});

describe("computeCalibrationProbability()", () => {
  it("returns expectedOutcome / milestone clamped to [0, 1]", () => {
    expect(computeCalibrationProbability(300_000, 1_000_000)).toBeCloseTo(0.3);
    expect(computeCalibrationProbability(1_000_000, 500_000)).toBe(1); // clamped
    expect(computeCalibrationProbability(0, 500_000)).toBe(0.5); // degenerate
  });
});

// ── calculateContractRecommendations() ───────────────────────────────────────

describe("calculateContractRecommendations()", () => {
  const consistentViews = Array(10).fill(1_000_000);

  it("low-risk tier applies 3.0× multiplier on expectedOutcome", () => {
    // confidence=80 → low risk; age=6h; consistent channel avg 1M
    const result = calculateContractRecommendations(
      80,
      500_000,
      6,
      consistentViews
    );
    expect(result.riskTier).toBe("low");
    const expected = computeExpectedOutcome(500_000, 6, result.resolutionHours, 1_000_000);
    // milestone should be approx 3.0× expectedOutcome (with rounding tolerance)
    expect(result.milestoneThreshold).toBeGreaterThanOrEqual(expected * 3.0 * 0.9);
  });

  it("medium-risk tier applies 2.5× multiplier on expectedOutcome", () => {
    const chaoticViews = [100_000, 900_000, 200_000, 800_000, 150_000];
    const result = calculateContractRecommendations(
      55,
      300_000,
      8,
      chaoticViews
    );
    expect(result.riskTier).toBe("medium");
    const avg = chaoticViews.reduce((a, b) => a + b, 0) / chaoticViews.length;
    const expected = computeExpectedOutcome(300_000, 8, result.resolutionHours, avg);
    expect(result.milestoneThreshold).toBeGreaterThanOrEqual(expected * 2.5 * 0.9);
  });

  it("high-risk tier applies 2.2× multiplier on expectedOutcome", () => {
    const result = calculateContractRecommendations(
      20,
      200_000,
      10,
      consistentViews
    );
    expect(result.riskTier).toBe("high");
    const expected = computeExpectedOutcome(200_000, 10, result.resolutionHours, 1_000_000);
    expect(result.milestoneThreshold).toBeGreaterThanOrEqual(expected * 2.2 * 0.9);
  });

  it("milestone always exceeds channel avg at window horizon (channel-as-floor invariant)", () => {
    // Channel avg 400K — milestone must exceed channelAvgAtHorizon regardless of velocity
    const lowVelocityViews = 20_000; // video is slow but channel is big
    const channelAvg = 400_000;
    const result = calculateContractRecommendations(
      80,
      lowVelocityViews,
      5, // 5h old → 24h window
      consistentViews,
      channelAvg
    );
    const floor = channelAvgAtHorizon(channelAvg, result.resolutionHours);
    expect(result.milestoneThreshold).toBeGreaterThan(floor);
  });

  it("estimated probability targets 25–45% range", () => {
    const cases: [number, number, number, number, number[]][] = [
      [80, 500_000, 6, 1_000_000, consistentViews],
      [55, 300_000, 8, 500_000, consistentViews],
      [20, 200_000, 10, 400_000, consistentViews],
    ];
    for (const [confidence, views, age, channelAvg, recent] of cases) {
      const result = calculateContractRecommendations(
        confidence,
        views,
        age,
        recent,
        channelAvg
      );
      // Probability should be in 25–45% range (with some tolerance for rounding)
      expect(result.estimatedProbability).toBeGreaterThanOrEqual(0.20);
      expect(result.estimatedProbability).toBeLessThanOrEqual(0.55);
    }
  });

  it("uses channelAvgViews for outperformance computation when provided", () => {
    // With the new age-based resolveWindow, a 5h old video → 24h window regardless of perf
    const result = calculateContractRecommendations(
      80,
      1_000_000,
      5,
      consistentViews,
      500_000
    );
    expect(result.resolutionHours).toBe(24); // age=5h < 20h → 24h window
  });

  it("all three tiers set predictionSource to 'algorithmic'", () => {
    for (const confidence of [80, 55, 20]) {
      const result = calculateContractRecommendations(
        confidence,
        500_000,
        6,
        consistentViews
      );
      expect(result.predictionSource).toBe("algorithmic");
    }
  });
});
