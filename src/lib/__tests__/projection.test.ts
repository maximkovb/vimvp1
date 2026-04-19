import { describe, it, expect } from "vitest";
import {
  computeProjectionLabel,
  DECELERATION_THRESHOLD,
  BREAKING_OUT_RATIO,
  ON_TRACK_RATIO,
  MIN_WINDOW_HOURS,
} from "../projection";

// 48h from now; milestone=1000, current=0 → required ≈ 20.83/h
const FUTURE = new Date(Date.now() + 48 * 60 * 60 * 1000);
const MILESTONE = 1000;
const CURRENT = 0;
const REQUIRED = MILESTONE / 48; // ≈ 20.83/h

function make(overrides: {
  currentMetric?: number;
  recentVelocityPerHour?: number | null;
  allTimeVelocityPerHour?: number | null;
  priorVelocityPerHour?: number | null;
  milestoneThreshold?: number;
  resolvesAt?: Date;
}) {
  return {
    currentMetric: CURRENT,
    recentVelocityPerHour: null,
    allTimeVelocityPerHour: null,
    priorVelocityPerHour: null,
    milestoneThreshold: MILESTONE,
    resolvesAt: FUTURE,
    ...overrides,
  };
}

describe("computeProjectionLabel()", () => {
  describe("boundary conditions", () => {
    it("returns AT_RISK when deadline has passed", () => {
      const past = new Date(Date.now() - 1000);
      expect(computeProjectionLabel(make({ resolvesAt: past, recentVelocityPerHour: 100, allTimeVelocityPerHour: 100 }))).toBe("AT_RISK");
    });

    it("returns BREAKING_OUT when milestone is already crossed", () => {
      expect(computeProjectionLabel(make({
        currentMetric: MILESTONE + 1,
        recentVelocityPerHour: 0,
        allTimeVelocityPerHour: 0,
      }))).toBe("BREAKING_OUT");
    });
  });

  describe("null velocity handling (R5 — new market < 15min)", () => {
    it("returns AT_RISK when both velocities are null", () => {
      expect(computeProjectionLabel(make({}))).toBe("AT_RISK");
    });

    it("returns AT_RISK when recentVelocity is null", () => {
      expect(computeProjectionLabel(make({ allTimeVelocityPerHour: 50 }))).toBe("AT_RISK");
    });

    it("returns AT_RISK when allTimeVelocity is null", () => {
      expect(computeProjectionLabel(make({ recentVelocityPerHour: 50 }))).toBe("AT_RISK");
    });

    it("returns AT_RISK when effectiveVelocity is zero", () => {
      expect(computeProjectionLabel(make({ recentVelocityPerHour: 0, allTimeVelocityPerHour: 50 }))).toBe("AT_RISK");
    });

    it("returns AT_RISK when effectiveVelocity is negative", () => {
      expect(computeProjectionLabel(make({ recentVelocityPerHour: -5, allTimeVelocityPerHour: 50 }))).toBe("AT_RISK");
    });
  });

  describe("happy paths", () => {
    it("returns BREAKING_OUT when velocity is well above required pace", () => {
      const velocity = REQUIRED * BREAKING_OUT_RATIO + 1;
      expect(computeProjectionLabel(make({
        recentVelocityPerHour: velocity,
        allTimeVelocityPerHour: velocity,
      }))).toBe("BREAKING_OUT");
    });

    it("returns ON_TRACK when velocity meets the ON_TRACK threshold", () => {
      const velocity = REQUIRED * ON_TRACK_RATIO + 1;
      expect(computeProjectionLabel(make({
        recentVelocityPerHour: velocity,
        allTimeVelocityPerHour: velocity,
      }))).toBe("ON_TRACK");
    });

    it("returns AT_RISK when velocity is below ON_TRACK threshold", () => {
      const velocity = REQUIRED * ON_TRACK_RATIO - 1;
      expect(computeProjectionLabel(make({
        recentVelocityPerHour: velocity,
        allTimeVelocityPerHour: velocity,
      }))).toBe("AT_RISK");
    });
  });

  describe("R6 — motivating example: stalled video with high all-time average", () => {
    it("returns AT_RISK when recent velocity is near zero despite high all-time velocity", () => {
      expect(computeProjectionLabel(make({
        recentVelocityPerHour: 0.1,
        allTimeVelocityPerHour: REQUIRED * 2,
      }))).toBe("AT_RISK");
    });
  });

  describe("R2 — short-term spike does not flip to ON_TRACK", () => {
    it("returns AT_RISK when all-time average is below required pace despite recent spike", () => {
      const recentSpike = REQUIRED * BREAKING_OUT_RATIO + 5;
      const poorAllTime = REQUIRED * ON_TRACK_RATIO - 1;
      expect(computeProjectionLabel(make({
        recentVelocityPerHour: recentSpike,
        allTimeVelocityPerHour: poorAllTime,
      }))).toBe("AT_RISK");
    });
  });

  describe("R3 — deceleration detection", () => {
    it("returns AT_RISK when recent velocity drops below 50% of prior velocity in borderline case", () => {
      const recent = REQUIRED * 0.6;
      const prior = REQUIRED * 2;
      expect(computeProjectionLabel(make({
        recentVelocityPerHour: recent,
        allTimeVelocityPerHour: recent,
        priorVelocityPerHour: prior,
      }))).toBe("AT_RISK");
    });

    it("does not fire when deceleration is modest (above threshold)", () => {
      // recent = 90% of required (ON_TRACK range), prior = 1.5x required
      // recent/prior = 0.9/1.5 = 0.6 > DECELERATION_THRESHOLD(0.5) -- not decelerating
      const recent = REQUIRED * 0.9;
      const prior = REQUIRED * 1.5;
      expect(computeProjectionLabel(make({
        recentVelocityPerHour: recent,
        allTimeVelocityPerHour: recent,
        priorVelocityPerHour: prior,
      }))).toBe("ON_TRACK");
    });
  });

  describe("R4 — deceleration protected by headroom", () => {
    it("does not demote to AT_RISK when recent velocity is still above required × BREAKING_OUT_RATIO", () => {
      const prior = REQUIRED * 10;
      const recent = REQUIRED * 5; // above BREAKING_OUT_RATIO threshold
      expect(computeProjectionLabel(make({
        recentVelocityPerHour: recent,
        allTimeVelocityPerHour: recent,
        priorVelocityPerHour: prior,
      }))).toBe("BREAKING_OUT");
    });
  });

  describe("priorVelocity absent — deceleration skipped", () => {
    it("returns ON_TRACK when prior is null and velocity meets threshold", () => {
      const velocity = REQUIRED * ON_TRACK_RATIO + 1;
      expect(computeProjectionLabel(make({
        recentVelocityPerHour: velocity,
        allTimeVelocityPerHour: velocity,
        priorVelocityPerHour: null,
      }))).toBe("ON_TRACK");
    });

    it("does not fire deceleration when prior velocity is zero", () => {
      const velocity = REQUIRED * ON_TRACK_RATIO + 1;
      expect(computeProjectionLabel(make({
        recentVelocityPerHour: velocity,
        allTimeVelocityPerHour: velocity,
        priorVelocityPerHour: 0,
      }))).toBe("ON_TRACK");
    });
  });

  describe("exported constants", () => {
    it("has expected constant values", () => {
      expect(DECELERATION_THRESHOLD).toBe(0.5);
      expect(BREAKING_OUT_RATIO).toBe(1.1);
      expect(ON_TRACK_RATIO).toBe(0.8);
      expect(MIN_WINDOW_HOURS).toBe(0.25);
    });
  });
});
