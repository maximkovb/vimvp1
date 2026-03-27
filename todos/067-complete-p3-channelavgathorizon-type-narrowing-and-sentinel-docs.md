---
status: complete
priority: p3
issue_id: "067"
tags: [code-review, typescript, calibration]
dependencies: []
---

# `channelAvgAtHorizon` accepts `number` but silently misbehaves for non-preset values; `computeCalibrationProbability` 0.5 sentinel undocumented

## Problem Statement

Two related issues in `src/lib/calibration.ts`:

### 1. `channelAvgAtHorizon` silent default branch

```typescript
if (windowHours <= 24) return Math.round(channelAvgViews * 0.55);
if (windowHours <= 48) return Math.round(channelAvgViews * 0.8);
return Math.round(channelAvgViews); // comment says "72h → 100%"
```

The final `return` applies to any value above 48 — including 36, 60, 96, or 168. A `36h` input returns 80% (slightly off), and any value above 72 returns 100% (semantically wrong — the 100% accumulation assumption only holds at 72h). The parameter type is `number`, not `24 | 48 | 72`, so there is no type-level guard.

Currently all callers pass valid preset values, but the type permits any number and the silent default is a future footgun.

### 2. `computeCalibrationProbability` returns `0.5` for degenerate input

```typescript
if (expectedOutcome <= 0 || milestone <= 0) return 0.5;
```

The `0.5` sentinel is indistinguishable from a genuine 50% probability at call sites. The JSDoc does not document this behaviour. If a caller uses the result in a floor check or display without being aware of the sentinel, it will silently treat "no data" as "50% calibrated."

## Proposed Solutions

### For `channelAvgAtHorizon`

**Option A (Recommended):** Narrow the parameter type to `24 | 48 | 72`. Any call site that passes a raw `number` gets a compile error forcing explicit handling.

```typescript
export function channelAvgAtHorizon(
  channelAvgViews: number,
  windowHours: 24 | 48 | 72
): number
```

**Option B:** Keep `number` but add an explicit guard and a descriptive comment that the default is intentionally the 72h case:

```typescript
// windowHours values other than 24/48/72 are not calibrated — treat any value > 48 as 72h
```

### For `computeCalibrationProbability`

Add a JSDoc note:

```typescript
/**
 * Returns expectedOutcome / milestone, clamped to [0, 1].
 * Returns 0.5 as a neutral sentinel when either input is <= 0 (data unavailable).
 * Callers must treat 0.5 as "no data", not as a calibrated probability.
 */
```

Or change the return type to `number | null` and return `null` for degenerate input — forcing callers to handle the "no data" case explicitly.

- **Effort**: Small
- **Risk**: Low for type narrowing (compile-time only); Low for JSDoc addition; Medium for `null` return type (requires updating call sites)

## Acceptance Criteria

- [ ] `channelAvgAtHorizon` either accepts only `24 | 48 | 72` at the type level, or has explicit documentation of what happens for other values
- [ ] `computeCalibrationProbability` JSDoc documents the `0.5` sentinel meaning
- [ ] TypeScript compiles clean

## Work Log

- 2026-03-27: Identified during `/ce:review` — kieran-typescript-reviewer, architecture-strategist
