---
title: "Mobile FeedCard: Expandable Bet Tray & Nav Bar Clearance Fixes"
category: ui-bugs
date: 2026-04-18
tags:
  - mobile
  - feedcard
  - safe-area
  - absolute-positioning
  - state-management
  - collapsible-ui
  - density-system
  - deactivate
modules_affected:
  - src/components/FeedCard.tsx
severity: medium
---

# Mobile FeedCard: Expandable Bet Tray & Nav Bar Clearance Fixes

Two related bugs fixed in the same session. Both concern mobile-only layout in `FeedCard`'s `lg:hidden` block.

---

## Bug 1: Expandable "Make Prediction" Tray — State Management Pitfalls

### Symptom

YES/NO bet buttons were hidden behind the device navigation bar. Replacement: a "Make Prediction" pill (collapsed by default) that expands in-place to show YES/NO. Several state management hazards emerged during implementation.

### Root Cause

`FeedCard` has two independent visibility systems — the **density system** (full/compact/minimal, controlled externally) and **local interaction state** (`isPaused`, and now `isBetExpanded`). These must be kept in sync manually; the density system has no awareness of local booleans. Additionally, `deactivate()` uses a `doStop` closure to guard against a `play()` promise race — any state reset placed outside that closure runs immediately but can be overwritten when the async promise resolves.

### Solution

**1. `isBetExpanded` state declaration**
```tsx
const [isBetExpanded, setIsBetExpanded] = useState(false);
```

**2. Reset inside `doStop()` — not at the top of `deactivate()`**

`deactivate()` guards against a play/pause race by awaiting `playPromiseRef.current` before pausing. A reset placed before this guard runs immediately, but the still-pending `play()` may resolve afterward and overwrite it. The reset must live inside `doStop()` alongside `setIsMuted` and `setIsPaused`:

```tsx
deactivate() {
  const doStop = () => {
    for (const v of [videoRef.current, desktopVideoRef.current]) {
      if (!v) continue;
      v.pause();
      v.muted = true;
    }
    setIsMuted(true);
    setIsPaused(true);
    setIsBetExpanded(false);  // ← must be inside doStop, not outside
  };
  if (playPromiseRef.current) {
    playPromiseRef.current.then(doStop).catch(doStop);
    playPromiseRef.current = null;
  } else {
    doStop();
  }
}
```

**3. Collapse on `minimal` density**

The density system does not automatically reset local booleans. An open tray during a fast-swipe transitions to invisible (`minimal`) but `isBetExpanded` stays `true` — the tray reappears when the user scrolls back. Fix: reset explicitly in `setDensity`:

```tsx
setDensity(density: Density) {
  setDensityState(density);
  if (density === "minimal") setIsBetExpanded(false);
},
```

**4. Card body `onClick` guard**

The outer mobile wrapper `onClick` was `() => isTrading && onTap()`. When the tray is open, tapping the card body should collapse the tray, not open BetSheet:

```tsx
onClick={() => {
  if (isBetExpanded) { setIsBetExpanded(false); return; }
  if (isTrading) onTap();
}}
```

**5. `isTrading` guard on the expanded render**

Use `{isBetExpanded && isTrading && (...)}` — not just `{isBetExpanded && (...)}`. If the market halts while the tray is open, the stale YES/NO buttons would remain interactive without this guard.

**6. Conditional render, not CSS toggling**

The established FeedCard rule (see [mobile-video-scrubber-inline-conditional-render.md](./mobile-video-scrubber-inline-conditional-render.md)):

- **Interaction state** (`isPaused`, `isBetExpanded`) → `{state && (...)}` conditional render (mount/unmount)
- **Information density** (full/compact/minimal) → `DENSITY_BUTTON_STYLE` opacity + pointer-events

Never mix these two systems. The density system already manages opacity transitions; adding a second CSS visibility layer on top causes conflicts.

**Final JSX structure:**
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
      <button onClick={(e) => { e.stopPropagation(); setIsBetExpanded(false); onTap(0); }}
        className="flex-1 py-3.5 rounded-full text-sm font-bold uppercase tracking-wide bg-green text-white hover:opacity-90 active:opacity-75">
        YES&nbsp;{(priceYes * 100).toFixed(0)}%
      </button>
      <button onClick={(e) => { e.stopPropagation(); setIsBetExpanded(false); onTap(1); }}
        className="flex-1 py-3.5 rounded-full text-sm font-bold uppercase tracking-wide bg-red text-white hover:opacity-90 active:opacity-75">
        NO&nbsp;{(priceNo * 100).toFixed(0)}%
      </button>
    </div>
  )}
</div>
```

### All `isBetExpanded` Reset Points

| Where | Why |
|-------|-----|
| `doStop()` inside `deactivate()` | User scrolls to next card — must be inside the promise guard |
| `setDensity("minimal")` | Fast swipe — density doesn't auto-reset local booleans |
| YES button tap | Collapse before opening BetSheet |
| NO button tap | Collapse before opening BetSheet |
| Card body `onClick` when `isBetExpanded` | User dismisses tray without betting |

`activate()` does NOT need to reset it — `deactivate()` always fires before `activate()` on card re-entry.

---

## Bug 2: Mobile Nav Bar Clearance in h-screen Containers

### Symptom

Progress bar (`absolute bottom-0 z-20`) and bottom content (`absolute bottom-0 z-10`) were hidden behind the fixed bottom nav bar. Switching to `bottom-16` (64px) left the 6px progress bar "barely peeking out."

### Root Cause

`h-screen` resolves to `height: 100vh` — the full viewport height regardless of ancestor padding. The `pb-16` on `main` correctly offsets normal flow content but `h-screen` snap-scroll cards ignore it and extend flush to the viewport bottom, where the fixed nav bar lives.

**Actual nav bar height:**

| Component | Height |
|-----------|--------|
| Wrapper `py-2` | 16px |
| Link content (icon 22px + gap 4px + text 13px + `py-1.5` 12px) | ~51px |
| `border-t` | 1px |
| **Total without safe area** | **~73px** |
| `env(safe-area-inset-bottom)` (modern iPhones) | +34px → ~107px |

`bottom-16` (64px) < 73px → progress bar partially hidden on all devices, fully hidden on iPhones.

### Solution

Use `calc(env(safe-area-inset-bottom, 0px) + 5rem)` as an inline style:

```tsx
// Before (broken):
<div className="absolute bottom-0 left-0 right-0 z-20">
<div className="absolute bottom-0 left-0 right-0 z-10 p-5">

// After (fixed):
<div className="absolute left-0 right-0 z-20"
     style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}>
<div className="absolute left-0 right-0 z-10 p-5"
     style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}>
```

**Why `5rem` (80px) base:**
- 80px > 73px nav → 7px clearance on Android / older iOS ✓
- 80 + 34 = 114px > 107px combined → 7px clearance on modern iPhones ✓

**Why not a Tailwind class:** Tailwind cannot compose `env()` environment variables into utility classes without a custom plugin. Inline style is correct for CSS env variable arithmetic. The `, 0px` fallback is required for browsers that don't support `env()`.

This pattern is already established in the project:
- `AppShell.tsx:25` — bottom nav's own `paddingBottom`
- `BetSheet.tsx:109` — sheet bottom padding

---

## Prevention

### Mental checklist for new local boolean state in FeedCard

When adding any `useState<boolean>` that controls visible UI:

- [ ] Reset in `doStop()` inside `deactivate()` (not outside the closure)
- [ ] Reset in `setDensity("minimal")` if hidden at minimal density
- [ ] Reset on every user action that should close the feature
- [ ] Add `onClick` guard on the card root to block `onTap()` when the feature is open
- [ ] Use conditional render `{state && (...)}`, not CSS opacity toggling
- [ ] Add `isTrading` guard on any content that should only show when market is active

### h-screen bottom positioning rule

Any `absolute bottom-*` inside a full-viewport (`h-screen`) snap-scroll card that must clear the fixed nav:
- **Do not** use `bottom-0`, `bottom-16`, or `pb-16`
- **Do** use `style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}`
- Test on a physical device or simulator with a home indicator — DevTools does not reliably reproduce `env(safe-area-inset-bottom)`

---

## Related

- [mobile-video-scrubber-inline-conditional-render.md](./mobile-video-scrubber-inline-conditional-render.md) — companion doc establishing the conditional-render-vs-density-system rule for FeedCard; `isPaused` is the same pattern as `isBetExpanded`
- [video-audio-cross-layout-bleed.md](./video-audio-cross-layout-bleed.md) — documents the `deactivate()`/`doStop` promise-guard architecture that dictates where `isBetExpanded` reset must live
