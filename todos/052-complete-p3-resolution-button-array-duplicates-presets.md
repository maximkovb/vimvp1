---
status: complete
priority: p3
issue_id: "052"
tags: [code-review, quality, dry]
---

# Resolution button array is a second source of truth for preset values

## Problem Statement

`RESOLUTION_PRESETS = [24, 48, 72, 168] as const` and the JSX button array `[["24","24h"],["48","48h"],["72","72h"],["168","7d"]] as const` both enumerate the same four preset values. Adding or removing a preset requires changes in two (or three, counting `ContractRecommendation.resolutionHours: 24 | 48 | 72 | 168` in `contract.ts`) places. The button array also uses string representations (`"24"`) while `RESOLUTION_PRESETS` uses numbers, requiring `Number(value)` casts in `handleResolutionButton`.

## Findings

- **File:** `src/app/admin/markets/new/page.tsx`
- `RESOLUTION_PRESETS` (line 13): numbers `[24, 48, 72, 168]`
- JSX map (line ~367): strings `[["24","24h"],...]`
- `handleResolutionButton` takes `hours: number` and is called with `Number(value)` — string-to-number round trip
- Three-way duplication with `resolutionHours: 24 | 48 | 72 | 168` in `src/lib/contract.ts:9`

## Proposed Solution

Add a `RESOLUTION_LABELS` record derived from `RESOLUTION_PRESETS`:

```ts
const RESOLUTION_LABELS: Record<(typeof RESOLUTION_PRESETS)[number], string> = {
  24: "24h", 48: "48h", 72: "72h", 168: "7d",
};
```

Then simplify the JSX:
```tsx
RESOLUTION_PRESETS.map((hours) => (
  <button key={hours} type="button"
    disabled={!anchorMilestone}
    onClick={() => handleResolutionButton(hours)}
    className={`... ${resolutionHours === String(hours) ? "bg-accent text-white" : "..."}`}>
    {RESOLUTION_LABELS[hours]}
  </button>
))
```

This eliminates the `Number(value)` cast, removes the parallel string array, and means adding a new preset only requires touching `RESOLUTION_PRESETS` and `RESOLUTION_LABELS`.

## Acceptance Criteria
- [ ] The resolution button array is derived from `RESOLUTION_PRESETS` (not redeclared)
- [ ] No `Number(value)` cast needed in the button's `onClick`
- [ ] All four buttons still render correctly with the correct labels
- [ ] Active-button highlighting still works

## Work Log
- 2026-03-23: Found by architecture-strategist and simplicity-reviewer during `/ce:review` of proportional milestone/resolution controls feature
