---
status: complete
priority: p2
issue_id: "048"
tags: [code-review, security, validation]
---

# `resolutionHours` has no server-side enum validation

## Problem Statement

`createMarket` in `admin.ts` does `parseInt(resolutionHours || "72")` with no bounds check or allowlist enforcement. Any admin (or a direct FormData POST bypassing the UI) can pass any integer — e.g., `0`, `8760` (1 year), `"72abc"`. The UI now more visibly controls this field via the new pill buttons, but the server doesn't enforce the same [24, 48, 72, 168] constraint. `resolutionHours = 0` produces a `resolvesAt` in the past and a `haltsAt` five minutes before that, which could immediately auto-resolve a newly created market.

## Findings

- **File:** `src/lib/actions/admin.ts` (around line 293)
- `hours = parseInt(resolutionHours || "72")` — no allowlist check
- Used to compute `resolvesAt = new Date(now + hours * 60 * 60 * 1000)` — invalid if `hours = 0`
- `parseInt("72abc")` silently returns `72` (no enforcement of intent)
- Client-side: `RESOLUTION_PRESETS = [24, 48, 72, 168]` enforces the values; server does not
- Pre-exists this PR but is more visible since this PR expands attention to `resolutionHours` configuration

## Proposed Solutions

### Option A: Allowlist check before date arithmetic (Recommended)
```ts
const VALID_RESOLUTION_HOURS = new Set([24, 48, 72, 168]);
const hours = parseInt(resolutionHours || "72");
if (!VALID_RESOLUTION_HOURS.has(hours)) {
  return { error: "resolutionHours must be 24, 48, 72, or 168" };
}
```
**Pros:** Simple, explicit, consistent with how `milestoneThreshold` is validated. **Cons:** None. **Effort:** Small. **Risk:** None.

### Option B: Zod enum validation in CreateMarketSchema
Add `resolutionHours: z.coerce.number().refine(v => [24,48,72,168].includes(v))` to the schema if one is used for the form.
**Pros:** Centralizes validation. **Cons:** More refactor. **Effort:** Small-Medium.

### Option C: Clamp to nearest preset
`hours = [24,48,72,168].reduce((best, p) => Math.abs(p-h) < Math.abs(best-h) ? p : best)` — same logic as client-side `snapToPreset`.
**Pros:** Never fails silently, always produces valid output. **Cons:** Silently corrects bad input; harder to debug. **Effort:** Small.

## Acceptance Criteria
- [ ] Submitting `resolutionHours=0` via FormData returns an error response
- [ ] Submitting `resolutionHours=8760` returns an error response
- [ ] Submitting `resolutionHours="72abc"` is caught
- [ ] Valid values 24, 48, 72, 168 continue to work

## Work Log
- 2026-03-23: Found by security-sentinel and agent-native-reviewer during `/ce:review` of proportional milestone/resolution controls feature
