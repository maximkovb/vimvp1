---
title: feat: Add Resolution Rules Accordion
type: feat
status: completed
date: 2026-04-17
---

# feat: Add Resolution Rules Accordion

## Overview

Add a collapsible accordion on `/markets/[id]` (rendered inside `MarketHUD`) and a pinned one-liner in the `BetSheet` header, both showing resolution rules derived at render time from existing `MarketData` fields. No DB migration, no new API fields.

---

## Motivation

Users bet without knowing exactly what "YES" or "NO" means. The resolution condition exists in the data (`milestoneThreshold`, `resolvesAt`, `questionType`) but is never surfaced in the UI. This bridges that gap at zero infrastructure cost.

---

## Proposed Solution

### Text Templates

```
yesCondition = "Resolves YES if video reaches {formatCount(milestoneThreshold)} {questionType} before {formattedDeadline}."
noCondition  = "Resolves NO if the milestone is not reached by {formattedDeadline}."
dataSource   = "TikTok public view count"  |  "TikTok public like count"  (conditional on questionType)
```

When `resolvesAt` is null: omit the deadline phrase; fall back to "before market closes".

### Surface 1 — `MarketHUD` accordion

- Collapsible. Default: **collapsed**.
- Located: below the odds block, **above the action slot**, outside the conditional status block — always renders independent of market status.
- Suppressed (returns `null`) for `status === "cancelled"` or `status === "failed"`.
- For `status === "resolved"`: renders with the historical conditions unchanged (ResolutionReveal already communicates the outcome; the accordion provides audit context).
- Click target: full-width row showing the YES condition one-liner + a chevron icon. Expands to show all four rows.

### Surface 2 — `BetSheet` one-liner

- Non-collapsible. Always visible once rendered.
- Positioned: **outside the scrollable body**, between the drag handle and the `overflow-y-auto` content block — stays pinned even when the user scrolls the sheet.
- During SWR loading window (`marketData === undefined`): render a single-line skeleton shimmer matching the height of the text row.
- When loaded: render `yesCondition` only (one line, no expand).
- Suppressed for `status === "cancelled"` or `status === "failed"`.

---

## Technical Considerations

### `milestoneThreshold` formatting
- Type in `MarketData`: `string` (BigInt serialized). Must `Number()` before passing to `formatCount`.
- Use `formatCount` from `src/lib/format.ts` — already used by `FeedCard` for the progress bar tooltip. Produces "5.0M" not "5000000".

### `questionType` exhaustiveness
- Schema union: `"views" | "likes"`. Data source label must be `questionType === "likes" ? "TikTok public like count" : "TikTok public view count"`. The spec's original wording hardcoded "view count" — that is incorrect for likes markets.

### Date formatting
- `resolvesAt` in `MarketData` is an ISO string (UTC). Render in user's local timezone using `new Date(market.resolvesAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })`. This matches precision used in `MarketHUD`'s countdown display.

### Accordion animation
- No animation library available. Use `max-height` CSS transition via Tailwind.
- Collapsed: `max-h-0 overflow-hidden`. Expanded: `max-h-96 overflow-hidden`. The resolution text is short and fixed — `max-h-96` (384px) will never clip it.
- Add `transition-[max-height] duration-200 ease-in-out` for smooth motion.

### New utility: `src/lib/resolution-rules.ts`
Extract the template logic into a pure function so both `MarketHUD` and `BetSheet` call the same formatting code:

```ts
// src/lib/resolution-rules.ts
import { formatCount } from './format';
import type { MarketData } from '@/types/market';

export interface ResolutionRules {
  yesCondition: string;
  noCondition: string;
  dataSource: string;
  deadline: string | null;
}

export function deriveResolutionRules(
  market: Pick<MarketData, 'milestoneThreshold' | 'resolvesAt' | 'questionType'>
): ResolutionRules {
  const count = formatCount(Number(market.milestoneThreshold));
  const metric = market.questionType;
  const dataSource =
    market.questionType === 'likes'
      ? 'TikTok public like count'
      : 'TikTok public view count';
  const deadline = market.resolvesAt
    ? new Date(market.resolvesAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null;

  const yesCondition = deadline
    ? `Resolves YES if video reaches ${count} ${metric} before ${deadline}.`
    : `Resolves YES if video reaches ${count} ${metric} before market closes.`;
  const noCondition = deadline
    ? `Resolves NO if the milestone is not reached by ${deadline}.`
    : `Resolves NO if the milestone is not reached before market closes.`;

  return { yesCondition, noCondition, dataSource, deadline };
}
```

### New component: `src/components/ResolutionRulesAccordion.tsx`
Used only in `MarketHUD`. Props: `{ market: MarketData }`.

> **Note:** `ChevronIcon` and `Row` in the sketch below are **not** existing components — implement them inline. For `ChevronIcon` use an inline SVG `▸`/`▾` or a plain Unicode character styled with Tailwind `rotate` transition. For `Row` inline a simple `<div className="flex justify-between gap-2"><span className="text-muted/60">{label}</span><span>{value}</span></div>` — no shared component needed at this scope.

```tsx
// src/components/ResolutionRulesAccordion.tsx
'use client';
import { useState } from 'react';
import { deriveResolutionRules } from '@/lib/resolution-rules';
import type { MarketData } from '@/types/market';

export function ResolutionRulesAccordion({ market }: { market: MarketData }) {
  const [open, setOpen] = useState(false);

  if (market.status === 'cancelled' || market.status === 'failed') return null;

  const rules = deriveResolutionRules(market);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm"
      >
        <span className="text-muted">{rules.yesCondition}</span>
        {/* inline chevron: rotate-90 when open */}
        <span className={`transition-transform duration-200 text-muted ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      <div
        className={`transition-[max-height] duration-200 ease-in-out overflow-hidden ${
          open ? 'max-h-96' : 'max-h-0'
        }`}
      >
        <div className="px-4 pb-4 flex flex-col gap-2 text-xs">
          {/* inline Row pattern: <div className="flex justify-between gap-2"><span className="text-muted/60">{label}</span><span className="text-muted">{value}</span></div> */}
          {/* YES condition row */}
          {/* NO condition row */}
          {rules.deadline && {/* Deadline row */}}
          {/* Data source row */}
        </div>
      </div>
    </div>
  );
}
```

---

## System-Wide Impact

### Interaction Graph
- `ResolutionRulesAccordion` reads `MarketData` already in scope in `MarketHUD` — no new data fetching, no side effects, no callbacks.
- `BetSheet` one-liner reads from the existing SWR `marketData` result — same fetch already used for `TradePanel` prices. No additional network requests.
- `deriveResolutionRules` is a pure function — no side effects, no global state.

### Error & Failure Propagation
- If `formatCount` throws (unexpected `milestoneThreshold` value), it will bubble up inside `deriveResolutionRules`. Guard: `Number(market.milestoneThreshold)` can produce `NaN` if the string is malformed. Add `|| 0` fallback: `Number(market.milestoneThreshold) || 0`.
- If `new Date(market.resolvesAt)` fails (malformed ISO string), `toLocaleString()` returns "Invalid Date". Guard: wrap in a try/catch or validate with `!isNaN(Date.parse(market.resolvesAt))`.

### State Lifecycle Risks
- Accordion state (`open`) is purely local UI state — no persistence, no shared state. No lifecycle risk.
- BetSheet one-liner state is derived from `marketData` — follows the same SWR invalidation/revalidation cycle as `TradePanel` prices. No additional state management needed.

### API Surface Parity
- No API changes. All data already returned by `GET /api/markets/[id]`.
- No prop changes to `TradePanel`. No changes to the five-site prop-threading table from `docs/solutions/ui-bugs/realtime-payout-calculator-client-side-lmsr.md`.

### Integration Test Scenarios
1. Active market with `resolvesAt` set → accordion shows correct formatted date in deadline row; one-liner in BetSheet renders after SWR resolves.
2. Active market with `resolvesAt === null` → deadline row absent from accordion; one-liner says "before market closes".
3. `questionType === "likes"` market → data source row reads "TikTok public like count".
4. `status === "cancelled"` market detail page → accordion not rendered (no resolution rules section in DOM).
5. BetSheet opened → one-liner shows skeleton shimmer immediately; resolves to text within SWR fetch cycle.

---

## Acceptance Criteria

- [ ] `ResolutionRulesAccordion` renders in `MarketHUD` below the odds block, above the action slot
- [ ] Accordion is collapsed by default; click/tap expands to show all rows
- [ ] Expanded view shows: YES condition, NO condition, deadline (if present), data source
- [ ] Accordion not rendered for `status === "cancelled"` or `status === "failed"`
- [ ] `questionType === "likes"` uses "likes" (not "views") in condition text and "TikTok public like count" as data source
- [ ] `resolvesAt === null` → deadline row absent; condition text ends with "before market closes"
- [ ] `milestoneThreshold` formatted via `formatCount` (e.g., "5.0M" not "5000000")
- [ ] Accordion `max-height` transition animates smoothly (no layout jump)
- [ ] BetSheet one-liner pinned above the scrollable content area — visible without scrolling
- [ ] BetSheet one-liner shows skeleton shimmer while `marketData` is loading
- [ ] BetSheet one-liner renders correct `yesCondition` text once loaded
- [ ] BetSheet one-liner not rendered for `status === "cancelled"` or `status === "failed"`
- [ ] `deriveResolutionRules` is a pure utility in `src/lib/resolution-rules.ts`, shared by both surfaces
- [ ] No new API routes, DB migrations, or prop changes to `TradePanel`

---

## Implementation Checklist

### Files to create
- [ ] `src/lib/resolution-rules.ts` — `deriveResolutionRules()` pure utility
- [ ] `src/components/ResolutionRulesAccordion.tsx` — accordion component (MarketHUD surface)

### Files to modify
- [ ] `src/components/MarketHUD.tsx` — import and render `<ResolutionRulesAccordion market={market} />` below odds block, outside the conditional action-slot div
- [ ] `src/components/BetSheet.tsx` — add one-liner text block (or skeleton) between drag handle and scrollable body; use `deriveResolutionRules(marketData)` when `marketData` is defined

### Verification checklist
- [ ] `outcome === 0` for YES — do not introduce `outcome === 1 ? "YES" : "NO"` anywhere
- [ ] `Number(market.milestoneThreshold) || 0` guard in `deriveResolutionRules`
- [ ] Date parse guard for `resolvesAt` in `deriveResolutionRules`
- [ ] BetSheet: `marketData?.status` check before rendering one-liner (handle undefined during load)

---

## Dependencies & Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `milestoneThreshold` BigInt string is malformed | Low | `Number() \|\| 0` guard + visible "0" fallback |
| `resolvesAt` ISO string is malformed | Very low | `Date.parse()` guard before `toLocaleString()` |
| Accordion placement conflicts with `ResolutionReveal` on resolved markets | Medium | Place accordion outside the conditional action-slot div; it sits above `ResolutionReveal`, providing historical context |
| BetSheet one-liner height shifts layout on load | Low | Reserve fixed height with skeleton shimmer matching text line height |

---

## Sources & References

### Internal References
- `src/components/BetSheet.tsx` — existing Vaul drawer pattern, SWR fetch structure
- `src/components/MarketHUD.tsx` — existing `market` object usage, conditional slot structure  
- `src/components/TradePanel.tsx` — reference-correct `outcome` encoding (`0=YES`)
- `src/lib/format.ts` — `formatCount` utility (already formats milestoneThreshold in FeedCard)
- `src/types/market.ts` — `MarketData` type, `MarketStatus`, `QuestionType`
- `src/db/schema.ts:91-130` — markets table schema (milestoneThreshold, resolvesAt, questionType columns)

### Institutional Learnings Applied
- `docs/solutions/logic-errors/market-outcome-resolution-and-display.md` — outcome encoding (`0=YES`, inversion bug pattern)
- `docs/solutions/ui-bugs/realtime-payout-calculator-client-side-lmsr.md` — five-site prop-threading table; BetSheet SWR loading window pattern

### Wiki
- `projects/virality/pages/features/getspike-parity-features.md` §5 — Resolution Rules Accordion spec
