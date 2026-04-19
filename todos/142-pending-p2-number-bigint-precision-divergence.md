---
status: pending
priority: p2
issue_id: "142"
tags: [code-review, security, data-integrity, bigint]
dependencies: []
---

# Number() on bigint poll counts silently loses precision; diverges from cron/oracle path

## Problem Statement

`page.tsx` now converts raw SQL poll count strings to `Number()`. `Number()` maps to IEEE 754 double, which loses precision for integers above `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991 ≈ 9 quadrillion). While TikTok view counts won't reach this in practice, the conversion is silent — no error, no NaN — meaning a corrupted value displays as correct. More critically, this creates a divergence: the cron/oracle path (`update-badges/route.ts`, `projection.ts`) still uses BigInt for the same fields, so the displayed progress bar could differ from the resolution oracle.

## Findings

- `src/app/page.tsx` lines 44–45: `Number(r.view_count)` / `Number(r.like_count)` on raw SQL strings
- `src/app/api/cron/update-badges/route.ts` line 43: still uses `BigInt()` for market resolution labeling
- `Number("9007199254740993")` silently returns `9007199254740992` — wrong, no error thrown
- The fix that resolved the BigInt/Number mixing crash was correct and necessary; the precision risk is the remaining concern
- `ProgressBar` uses count for display only (no financial calculations); `Number` is acceptable if validated
- The risk is low for TikTok view counts today but creates a maintenance trap as the platform scales

## Proposed Solutions

### Option 1: Add Number.isSafeInteger guard (Recommended)

```typescript
function safePollCount(s: string | null): number | null {
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n)) {
    console.error(`[poll] count out of safe integer range: ${s} — displaying null`);
    return null;
  }
  return n;
}

pollData = result.rows.map((r) => ({
  marketId: r.market_id,
  viewCount: safePollCount(r.view_count),
  likeCount: safePollCount(r.like_count),
}));
```

Shows `—` in ProgressBar instead of a silently wrong value. Logs the incident for monitoring.

**Pros:** Correct error behavior; auditable; display remains safe
**Cons:** None — out-of-range counts would be a data anomaly worth logging regardless
**Effort:** Small | **Risk:** Low

### Option 2: Keep Number() as-is with a code comment

Add a comment noting the safe integer limit and that TikTok counts are far below it.

**Pros:** No code change needed
**Cons:** Divergence from cron/oracle path remains; no protection if counts somehow spike or data is malformed
**Effort:** Minimal | **Risk:** Accepted

## Acceptance Criteria

- [ ] An out-of-range poll count string (`> MAX_SAFE_INTEGER`) renders `"—"` in the ProgressBar rather than a silently wrong value
- [ ] The log message is visible in Vercel logs for monitoring
- [ ] Normal view counts (< 1B) are unaffected

## Work Log

- 2026-04-17: Identified by security-sentinel in ce:review of feat/scroll-adaptive-metric-density
