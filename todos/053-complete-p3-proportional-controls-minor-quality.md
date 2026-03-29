---
status: complete
priority: p3
issue_id: "053"
tags: [code-review, quality, typescript]
---

# Minor quality issues in proportional controls (null checks, init state, JSDoc)

## Problem Statement

Three small quality issues found during review of the proportional controls feature:

1. **Truthy check on `number | null`**: `if (anchorMilestone && anchorHours)` treats `0` as falsy. While `0` is impossible from the domain, `!== null` is the correct TypeScript idiom for `number | null`.
2. **`resolutionHours` initialized to `"72"`**: Before an anchor loads, the `"72h"` button will have `bg-accent text-white` applied (active state) while simultaneously being `disabled:opacity-40`. Minor visual inconsistency — a pre-selected but greyed-out button.
3. **`computeStep` JSDoc inaccuracy**: Comment says "1/100th of anchor's order of magnitude" but the formula `10^(floor(log10(x))-1)` computes 1/10th of the order of magnitude. E.g., anchor=100000 → step=1000 (1/100th of anchor, but 1/10th of the order `10^5 = 100000`).

## Proposed Fixes

**Fix 1 — explicit null checks:**
```ts
// Before
if (anchorMilestone && anchorHours) {

// After
if (anchorMilestone !== null && anchorHours !== null) {
```

**Fix 2 — initialize resolutionHours to empty string:**
```ts
// Before
const [resolutionHours, setResolutionHours] = useState("72");

// After
const [resolutionHours, setResolutionHours] = useState("");
```
Update active-button check: `resolutionHours !== "" && resolutionHours === value`.
Also update the reset in `handleFetchVideo` to `setResolutionHours("")`.

**Fix 3 — fix JSDoc:**
```ts
// Before: /** Step size for the milestone slider: 1/100th of anchor's order of magnitude. Min 1. */
// After:  /** Step size for the milestone slider: 1/10th of the anchor's order of magnitude. Min 1. e.g. anchor=100000 → step=1000 */
```

## Acceptance Criteria
- [ ] `if (anchorMilestone !== null && anchorHours !== null)` used throughout
- [ ] No preset button appears visually active before a contract loads
- [ ] `computeStep` JSDoc accurately describes the formula

## Work Log
- 2026-03-23: Found by TypeScript reviewer during `/ce:review` of proportional milestone/resolution controls feature
