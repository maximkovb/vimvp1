---
title: Remove "Make Prediction" Button — Show YES/NO Directly
type: feat
status: completed
date: 2026-04-18
---

# Remove "Make Prediction" Button — Show YES/NO Directly

## Overview

Currently on mobile, the prediction flow requires two taps: first tap "Make Prediction" to expand the tray, then tap YES or NO to open the trading sheet. This plan removes the first step so YES/NO buttons appear immediately when a card is active, without any intermediate expand step.

Desktop is unaffected — it already shows `TradePanel` inline in the sidebar HUD with no intermediate button.

## Problem Statement

The "Make Prediction" button is an unnecessary friction point. Users must tap twice before they can even see the YES/NO options. Removing it reduces the interaction to a single tap and makes the intent of the UI immediately clear.

## Proposed Solution

Remove the `Make Prediction` button entirely from `FeedCard.tsx`. Change the YES/NO button visibility condition from `isBetExpanded && isTrading` to just `isTrading`. Then clean up all state and logic that was only needed to support the expand/collapse toggle.

## Technical Approach

All changes are isolated to `FeedCard.tsx`. No changes needed in `DiscoverFeed.tsx`, `BetSheet.tsx`, or `TradePanel.tsx` — `onTap` / `openSheet` / `initialOutcome` wiring is unchanged.

### Files to Change

#### `src/components/FeedCard.tsx`

**1. Remove the state declaration** (line 275):
```tsx
// DELETE this line:
const [isBetExpanded, setIsBetExpanded] = useState(false);
```

**2. Remove the "Make Prediction" button block** (lines 686–695):
```tsx
// DELETE this entire block:
{isTrading && !isBetExpanded && (
  <button
    onClick={(e) => { e.stopPropagation(); setIsBetExpanded(true); }}
    className="w-full py-3.5 rounded-full ..."
  >
    <ChevronUpIcon />
    Make Prediction
  </button>
)}
```

**3. Simplify the YES/NO visibility condition** (line 697):
```tsx
// BEFORE:
{isBetExpanded && isTrading && (

// AFTER:
{isTrading && (
```

**4. Remove `setIsBetExpanded(false)` calls from YES and NO onClick handlers** (lines 700, 712):
```tsx
// BEFORE (YES button):
onClick={(e) => {
  e.stopPropagation();
  setIsBetExpanded(false);  // DELETE this line
  onTap(0);
}}

// BEFORE (NO button):
onClick={(e) => {
  e.stopPropagation();
  setIsBetExpanded(false);  // DELETE this line
  onTap(1);
}}
```

**5. Remove `isBetExpanded` reset in `deactivate()` / `doStop()`** (line 349):
```tsx
// DELETE:
setIsBetExpanded(false);
```

**6. Remove `isBetExpanded` reset in `setDensity("minimal")` handler** — wherever density transitions collapse the tray, remove the `setIsBetExpanded(false)` call.

**7. Remove the card body `onClick` guard** — the card body click currently checks `isBetExpanded` to collapse the tray instead of opening BetSheet. That guard can be removed since the tray no longer has a collapsed state.

> ⚠️ **Institutional learning:** There are exactly **5 reset points** for `isBetExpanded` documented in `docs/solutions/ui-bugs/mobile-bet-tray-nav-clearance-fixes.md`. All must be cleaned up: `doStop()`, `setDensity("minimal")`, YES tap, NO tap, and card body `onClick`. Missing one causes stale state on card re-entry.

## Acceptance Criteria

- [ ] On mobile, when a card is active (`isTrading === true`), YES and NO buttons are immediately visible — no "Make Prediction" button precedes them
- [ ] Tapping YES opens `BetSheet` pre-selected on YES (`initialOutcome=0`)
- [ ] Tapping NO opens `BetSheet` pre-selected on NO (`initialOutcome=1`)
- [ ] Desktop behavior is unchanged (sidebar HUD still shows inline `TradePanel`)
- [ ] Scrolling away from a card and back shows YES/NO immediately (no stale `isBetExpanded` false state)
- [ ] Market halt mid-view: when `isTrading` becomes false, YES/NO buttons disappear correctly
- [ ] No TypeScript errors from removed `isBetExpanded` references

## Risks

- **Stale `isBetExpanded` references:** The state is referenced in ~5 places. Missing any cleanup causes a TS error (easiest case) or a runtime logic bug (harder to spot). Use `grep -n isBetExpanded src/components/FeedCard.tsx` after changes to confirm zero remaining references.
- **Card body onClick guard:** If the body-click guard is left in but `isBetExpanded` is removed, it will always short-circuit to the collapse path and never open BetSheet. Must be removed together.

## Sources & References

- Implementation file: `src/components/FeedCard.tsx:275` (state), `:686–720` (button blocks)
- Feed wiring: `src/components/DiscoverFeed.tsx:192–207` (openSheet / cardTapHandlers — no changes needed)
- Trading sheet: `src/components/BetSheet.tsx` — no changes needed
- Institutional learning (reset points): `docs/solutions/ui-bugs/mobile-bet-tray-nav-clearance-fixes.md`
- Institutional learning (outcome encoding): `docs/solutions/logic-errors/market-outcome-resolution-and-display.md` — YES=0, NO=1; do not invert
