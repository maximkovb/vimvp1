import { describe, it, expect } from "vitest";
import {
  assignRiskTier,
  calculateConfidence,
  roundToClean,
  resolveWindow,
  calculateContractRecommendations,
} from "../contract";

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
  it("returns 24h for viral video (≥12h old, factor ≥ 3.0)", () => {
    expect(resolveWindow(12, 3.0, 0.8)).toBe(24);
    expect(resolveWindow(24, 5.0, 0.9)).toBe(24);
  });

  it("does NOT return 24h if video is younger than 12h", () => {
    expect(resolveWindow(11.9, 3.0, 0.8)).not.toBe(24);
  });

  it("does NOT return 24h if outperformance factor is below 3.0", () => {
    expect(resolveWindow(12, 2.9, 0.8)).not.toBe(24);
  });

  it("returns 48h for young video with strong momentum (<36h, factor ≥ 1.5)", () => {
    expect(resolveWindow(6, 1.5, 0.7)).toBe(48);
    expect(resolveWindow(35, 2.0, 0.8)).toBe(48);
  });

  it("does NOT return 48h if video is ≥36h old", () => {
    expect(resolveWindow(36, 2.0, 0.8)).not.toBe(48);
  });

  it("returns 168h for chaotic channel (consistency < 0.3)", () => {
    expect(resolveWindow(48, 1.0, 0.29)).toBe(168);
  });

  it("returns 168h for underperforming video (factor < 0.8)", () => {
    expect(resolveWindow(48, 0.79, 0.6)).toBe(168);
  });

  it("returns 72h as the default", () => {
    expect(resolveWindow(48, 1.2, 0.7)).toBe(72);
    expect(resolveWindow(100, 1.0, 0.5)).toBe(72);
  });
});

describe("calculateContractRecommendations()", () => {
  // A consistent mid-tier channel: confidence=80 → low risk
  const consistentViews = Array(10).fill(1_000_000);

  // Helper: compute logarithmic projection (mirrors contract.ts formula)
  function project(
    currentViews: number,
    videoAgeHours: number,
    window: number
  ): number {
    const safeAge = Math.max(videoAgeHours, 0.1);
    return Math.round(
      currentViews * (Math.log(window + 1) / Math.log(safeAge + 1))
    );
  }

  it("low-risk tier applies ≥ 2.0× multiplier on projection", () => {
    // confidence=80 → low; age=6h in sweet spot; consistent channel
    const result = calculateContractRecommendations(
      80,
      500_000,
      6,
      consistentViews
    );
    expect(result.riskTier).toBe("low");
    const window = result.resolutionHours;
    const proj = project(500_000, 6, window);
    // threshold should be at least 2× the raw projection (before rounding)
    expect(result.milestoneThreshold).toBeGreaterThanOrEqual(proj * 2.0 * 0.9); // 10% rounding tolerance
  });

  it("medium-risk tier applies ≥ 1.5× multiplier on projection", () => {
    // confidence=55 → medium; chaotic channel (low consistency → 168h window)
    const chaoticViews = [100_000, 900_000, 200_000, 800_000, 150_000];
    const result = calculateContractRecommendations(
      55,
      300_000,
      8,
      chaoticViews
    );
    expect(result.riskTier).toBe("medium");
    const window = result.resolutionHours;
    const proj = project(300_000, 8, window);
    expect(result.milestoneThreshold).toBeGreaterThanOrEqual(proj * 1.5 * 0.9);
  });

  it("high-risk tier applies ≥ 1.2× multiplier on projection", () => {
    // confidence=20 → high
    const result = calculateContractRecommendations(
      20,
      200_000,
      10,
      consistentViews
    );
    expect(result.riskTier).toBe("high");
    const window = result.resolutionHours;
    const proj = project(200_000, 10, window);
    expect(result.milestoneThreshold).toBeGreaterThanOrEqual(proj * 1.2 * 0.9);
  });

  it("threshold is always above the raw projection (never trivially easy)", () => {
    const cases: [number, number, number, number[]][] = [
      [80, 1_000_000, 6, consistentViews],
      [55, 500_000, 12, consistentViews],
      [20, 200_000, 24, consistentViews],
    ];
    for (const [confidence, views, age, recent] of cases) {
      const result = calculateContractRecommendations(
        confidence,
        views,
        age,
        recent
      );
      const proj = project(views, age, result.resolutionHours);
      expect(result.milestoneThreshold).toBeGreaterThan(proj);
    }
  });

  it("all three tiers set predictionSource to 'algorithmic'", () => {
    const tiers = [80, 55, 20];
    for (const confidence of tiers) {
      const result = calculateContractRecommendations(
        confidence,
        500_000,
        6,
        consistentViews
      );
      expect(result.predictionSource).toBe("algorithmic");
    }
  });

  it("uses channelAvgViews for outperformance factor when provided", () => {
    // Video is 2× channel avg → outperformanceFactor=2 → strong momentum early → 48h expected
    // confidence=80 (low risk), age=5h (<36h), factor=2 (≥1.5) → resolveWindow → 48h
    const result = calculateContractRecommendations(
      80,
      1_000_000,
      5,
      consistentViews,
      500_000 // channelAvgViews: video is 2× avg
    );
    expect(result.resolutionHours).toBe(48);
  });

  it("resolutionHours is always a valid enum value", () => {
    const valid = new Set([24, 48, 72, 168]);
    for (const confidence of [80, 55, 20]) {
      const result = calculateContractRecommendations(
        confidence,
        500_000,
        10,
        consistentViews
      );
      expect(valid.has(result.resolutionHours)).toBe(true);
    }
  });
});
