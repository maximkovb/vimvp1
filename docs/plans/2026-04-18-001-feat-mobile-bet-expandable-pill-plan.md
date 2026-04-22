---
title: "feat: Mobile Expandable Make Prediction Pill"
type: feat
status: completed
date: 2026-04-18
origin: docs/brainstorms/2026-04-18-mobile-bet-expandable-tray-requirements.md
---

# feat: Mobile Expandable "Make Prediction" Pill

## Overview

On mobile, the YES/NO bet buttons sit at the bottom of `FeedCard` and are obscured by the device navigation bar. This replaces the two-button pair with a single collapsed "Make Prediction" pill. Tapping it reveals YES/NO inline; tapping YES or NO opens BetSheet (existing flow) and collapses the tray. Desktop is untouched.

---

## Problem Statement

The YES/NO buttons render inside `absolute bottom-0` padding in `FeedCard`'s mobile layout (`lg:hidden`), which places them behind the device navigation bar. The buttons are unreachable without the user scrolling or adjusting device chrome settings. Simply moving them up would add vertical clutter while scrolling. A collapsed trigger solves both: the nav bar no longer obscures anything, and the feed looks clean mid-scroll.

---

## Proposed Solution

Add a single `isBetExpanded: boolean` local state to `FeedCard`. In the mobile layout, replace the YES/NO `<div>` with:

- **Collapsed (`!isBetExpanded && isTrading`):** a full-width "Make Prediction" pill button with an upward chevron.
- **Expanded (`isBetExpanded`):** the existing YES and NO buttons.
- **Not trading (`!isTrading`):** nothing rendered (empty slot).

The pill and YES/NO wrapper share the same `DENSITY_BUTTON_STYLE` div so density transitions continue working without changes to the density system.

---

## Technical Considerations

### File to change: `src/components/FeedCard.tsx`

Only `FeedCard.tsx` requires edits. No other component is affected.

**1. New state variable** — add at the top of the component alongside existing state:
```tsx
const [isBetExpanded, setIsBetExpanded] = useState(false);
```

**2. `deactivate()` — reset tray** (line ~340):
Add `setIsBetExpanded(false)` inside `doStop` — **not** at the top of `deactivate()`. If placed outside `doStop`, a still-pending `play()` promise could resolve after the reset. Place it alongside the existing `setIsMuted(true)` and `setIsPaused(true)` calls inside `doStop`.

**3. `setDensity()` — collapse on `minimal`**:
When density transitions to `minimal`, force `isBetExpanded` to `false`. This keeps the density system and expand state coherent — an invisible card should never persist an "open" tray that reappears on scroll-back.
```tsx
setDensity(density: Density) {
  setDensityState(density);
  if (density === "minimal") setIsBetExpanded(false);
},
```

**4. Card body `onClick` guard** (line 543):
The outer mobile wrapper `onClick` currently calls `onTap()` when `isTrading`. When the tray is expanded, tapping the card body should collapse the tray instead of opening BetSheet:
```tsx
onClick={() => {
  if (isBetExpanded) {
    setIsBetExpanded(false);
    return;
  }
  if (isTrading) onTap();
}}
```
This preserves the "tap card to bet" ergonomic for the collapsed state while giving users a way to dismiss an open tray.

**5. Replace the YES/NO button block** (lines 675–708):

Replace the `<div className="flex gap-3" style={DENSITY_BUTTON_STYLE[densityState]}>` + its two children with:

```tsx
<div style={DENSITY_BUTTON_STYLE[densityState]}>
  {isTrading && !isBetExpanded && (
    <button
      onClick={(e) => { e.stopPropagation(); setIsBetExpanded(true); }}
      className="w-full py-3.5 rounded-full text-sm font-bold uppercase tracking-wide bg-white/10 text-white hover:bg-white/15 active:bg-white/20 flex items-center justify-center gap-2"
    >
      <ChevronUpIcon />
      Make Prediction
    </button>
  )}
  {isBetExpanded && isTrading && (
    <div className="flex gap-3">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsBetExpanded(false);
          onTap(0);
        }}
        className="flex-1 py-3.5 rounded-full text-sm font-bold uppercase tracking-wide bg-green text-white hover:opacity-90 active:opacity-75"
      >
        YES&nbsp;{(priceYes * 100).toFixed(0)}%
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsBetExpanded(false);
          onTap(1);
        }}
        className="flex-1 py-3.5 rounded-full text-sm font-bold uppercase tracking-wide bg-red text-white hover:opacity-90 active:opacity-75"
      >
        NO&nbsp;{(priceNo * 100).toFixed(0)}%
      </button>
    </div>
  )}
</div>
```

**6. Add `ChevronUpIcon`** — small inline SVG, same style as `MutedIcon`/`UnmutedIcon` already in the file:
```tsx
function ChevronUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" />
    </svg>
  );
}
```

### What does NOT change

- `BetSheet`, `TradePanel`, `DiscoverFeed`, `MarketHUD` — zero changes.
- Desktop layout (`lg:flex` block in FeedCard) — zero changes.
- The density system, `DENSITY_BUTTON_STYLE`, `setDensity()` external signature — only the internal body of `setDensity` gets one extra line.
- `onTap` signature and prop threading — unchanged.
- The scrubber, progress bar, milestone text — unchanged.

### Animation

Instant toggle (no transition) — consistent with the scrubber visibility behavior established in the prior `mobile-scrubber-pause-only` feature. The `DENSITY_BUTTON_STYLE` transition handles fade-in/out on density changes as before; the expand/collapse itself is conditional render (mount/unmount), so it is instant.

---

## System-Wide Impact

- **Interaction graph**: Pill tap → `setIsBetExpanded(true)`. YES/NO tap → `setIsBetExpanded(false)` + `onTap(0/1)` → `openSheet()` in `DiscoverFeed` → `BetSheet` opens. Card scroll-away → `deactivate()` → `setIsBetExpanded(false)`. Card body tap while expanded → `setIsBetExpanded(false)`. No external state involved.
- **Error propagation**: No new error paths. The pill never initiates a network call.
- **State lifecycle risks**: `isBetExpanded` is reset in three places — `deactivate()`, `setDensity("minimal")`, and each YES/NO button tap. `activate()` does not need to reset it because `deactivate()` always fires before `activate()` on a new card entry.
- **API surface parity**: No API changes. The bet flow (`onTap` → BetSheet → TradePanel → `/api/trades`) is unchanged.

---

## Acceptance Criteria

- [ ] **R1.** On mobile, the YES/NO buttons are gone from the default (collapsed) scroll state. A single "Make Prediction" pill with a chevron icon appears in their place.
- [ ] **R2.** Tapping "Make Prediction" reveals YES and NO buttons (same styling + prices as today) in the same slot.
- [ ] **R3.** Tapping YES or NO calls `onTap(0/1)`, opens BetSheet, and instantly collapses the tray back to the pill.
- [ ] **R4.** The pill is not rendered when `status !== "active"`. Non-trading state shows an empty slot.
- [ ] **R5.** In `minimal` density the pill is hidden (`opacity: 0, pointerEvents: none`) via existing `DENSITY_BUTTON_STYLE`. In `compact` and `full` it is visible.
- [ ] **R5b.** If the tray is expanded when density transitions to `minimal`, `isBetExpanded` resets to `false` (pill re-appears when density returns to `full`).
- [ ] **R6.** When `deactivate()` fires (user scrolls to next card), the tray collapses to pill.
- [ ] **R7.** Desktop layout (`≥ 1024px`) is unchanged.
- [ ] Tapping the card body (video/gradient area) while the tray is expanded collapses the tray instead of opening BetSheet.
- [ ] Tapping the card body while the tray is collapsed still opens BetSheet (no regression).

---

## Dependencies & Risks

- **No external dependencies.** This is a pure FeedCard local state change.
- **Risk — non-trading UX regression.** Current code shows dimmed disabled YES/NO buttons when not trading (visible affordance that betting exists but is paused). R4 removes this — nothing is rendered. If desired, a future iteration could add a "Betting halted" label, but that is out of scope here.

---

## Sources & References

**Origin document:** [docs/brainstorms/2026-04-18-mobile-bet-expandable-tray-requirements.md](../brainstorms/2026-04-18-mobile-bet-expandable-tray-requirements.md)

Key decisions carried forward:
- Label is "Make Prediction" (not "Place Bet")
- Expand/collapse is instant (no animation)
- Desktop unchanged; density system unchanged

**Internal references:**
- FeedCard mobile layout + YES/NO buttons: `src/components/FeedCard.tsx:542–710`
- `deactivate()` impl: `src/components/FeedCard.tsx:329–348`
- `setDensity()` imperative handle: `src/components/FeedCard.tsx:290–292`
- `DENSITY_BUTTON_STYLE`: `src/components/FeedCard.tsx:57–61`
- `onTap` wiring in DiscoverFeed: `src/components/DiscoverFeed.tsx:192–207`
- Existing toggle pattern (boolean + conditional render): `src/components/CreatorBaselineCard.tsx:29–91`
- Institutional learning (FeedCard state patterns): `docs/solutions/ui-bugs/mobile-video-scrubber-inline-conditional-render.md`
