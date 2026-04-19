---
title: "Async Timing Gaps in React Trading UI: Double-Submit Window and Missing onPointerCancel"
date: 2026-04-18
category: docs/solutions/ui-bugs/
module: Trade Panel / CoinSlider
problem_type: ui_bug
component: tooling
symptoms:
  - "Buy button remains enabled during async staleness check — rapid double-click submits two trades"
  - "Mobile drag slider gets stuck: onPointerCancel never fires after scroll gesture cancels drag, leaving isDragging=true"
root_cause: async_timing
resolution_type: code_fix
severity: high
tags: [react, use-transition, async, double-submit, pointer-events, drag, mobile, financial-ui]
---

# Async Timing Gaps in React Trading UI: Double-Submit Window and Missing onPointerCancel

## Problem

Two independent async-timing bugs were found in the trade panel during a code review. Both are silent in normal usage but dangerous under real-world conditions: one allows duplicate trade submissions on double-click; the other leaves mobile drag state corrupted after a scroll gesture.

## Symptoms

- Rapid double-click on the Buy button during a slow network submits two separate trades. The server's optimistic-lock retry loop may let both succeed.
- On iOS / Android, starting a drag on the CoinSlider then scrolling does not reset the drag state. The next pointer interaction updates the trade amount without the user intending to change it.

## What Didn't Work

- Disabling the button via `isPending` from `useTransition` is **not** sufficient to block the double-submit window. `isPending` only becomes `true` after `startTransition` fires inside `executeBuy`, which runs _after_ the async `checkStaleness` network call. The entire round-trip is unprotected.
- CSS `pointer-events: none` on the slider wrapper does **not** stop already-captured pointer events. Once `setPointerCapture` is called in `onPointerDown`, subsequent events continue routing to the capture target regardless of CSS, until `pointerup` or `pointercancel` fires on that element.

## Solution

### 1. Close the double-submit window with a local `isChecking` state

Add a dedicated loading flag that covers the entire async path from click to transition start:

```typescript
const [isChecking, setIsChecking] = useState(false);

async function handleBuy() {
  if (amount < 1) { setError("Minimum trade is 1 coin"); return; }
  setError("");
  setStaleConfirm(null);
  setIsChecking(true);
  try {
    const canProceed = await checkStaleness();
    if (canProceed) executeBuy();
  } finally {
    setIsChecking(false);
  }
}

// Disable button during BOTH phases:
<button
  disabled={isPending || isChecking || !ready || amount < 1 || !!staleConfirm}
>
  {isPending ? "Buying..." : isChecking ? "Checking..." : `Buy ${outcome === 0 ? "YES" : "NO"} — ${amount} coins`}
</button>
```

### 2. Add `onPointerCancel` alongside `onPointerUp`

Any element using `setPointerCapture` must handle `pointercancel`. On mobile, a scroll gesture fires `pointercancel` instead of `pointerup`; the browser releases the capture automatically but the `isDragging` ref stays `true` without an explicit reset.

```typescript
function handlePointerUp() {
  isDragging.current = false;
}

// Register on the track div — same handler works for both:
<div
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
  onPointerUp={handlePointerUp}
  onPointerCancel={handlePointerUp}   // ← required for mobile
/>
```

## Why This Works

**Double-submit:** `useTransition`'s `isPending` flag reflects the transition lifecycle, not the pre-transition async work. Any async function called _before_ `startTransition` is completely invisible to `isPending`. A separate `isChecking` state closes this gap because it is set synchronously before the async call and cleared in `finally` after the transition fires.

**Pointer cancel:** The Pointer Events spec fires `pointercancel` when the browser "takes over" a pointer — most commonly when a scroll gesture begins on a touch device. The browser releases pointer capture on cancel, but event handlers still need to reset application state (`isDragging`) explicitly. `onPointerUp` and `onPointerCancel` should always receive the same cleanup handler on elements that use `setPointerCapture`.

## Prevention

- Any React button guarded by `useTransition.isPending` that also performs async work _before_ calling `startTransition` needs a dedicated loading flag. The pattern is: set flag → `try { await asyncWork(); startTransition(...) } finally { clear flag }`.
- Add a timeout to all staleness-check fetches: `{ signal: AbortSignal.timeout(8_000) }`. Without a timeout, a slow endpoint hangs the button indefinitely.
- Every drag component using `setPointerCapture` must register `onPointerCancel={handlePointerUp}` (or a cancel-specific handler). Treat it as mandatory alongside `onPointerUp`.
- Wrap `buyShares` (or any server action that re-throws) in try/catch inside the transition. Server actions that hit unexpected errors throw rather than return `{ error }`, which crashes the nearest error boundary instead of setting inline error state.

## Related Issues

- `docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md` — the SWR three-layer cache fix applied to `balanceFetcher` in the same PR
- `docs/solutions/ui-bugs/mobile-bet-tray-nav-clearance-fixes.md` — related pointer-event and interaction-state patterns in FeedCard
