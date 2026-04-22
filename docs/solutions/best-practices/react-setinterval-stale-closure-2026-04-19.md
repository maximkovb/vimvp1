---
title: Avoid stale closure in setInterval by syncing state to a ref
date: 2026-04-19
category: docs/solutions/best-practices/
module: FeedCard / React countdown
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - A setInterval callback needs to read React state that changes after the interval is created
  - A useEffect installs an interval keyed on deps that don't include the state the interval reads
  - The interval must self-terminate based on a React boolean state (e.g. isEnded)
tags: [react, setinterval, stale-closure, useref, countdown, useeffect]
---

# Avoid stale closure in setInterval by syncing state to a ref

## Context

When building a live countdown in `FeedCard`, the `useEffect` installs a `setInterval` keyed on `[resolvesAt, isEnded]`. The interval callback reads `isEnded` to decide whether to self-terminate. But closures in JavaScript close over variable values at creation time — the callback captures the value of `isEnded` when the effect runs, not the current value. If `isEnded` later flips to `true` (via the existing `setTimeout`), the interval never sees it and keeps firing.

## Guidance

Sync the changing state value into a `useRef` at the top of the effect, then read `ref.current` inside the interval callback.

```tsx
// ❌ Stale closure — interval captures isEnded=false at creation, never self-terminates
useEffect(() => {
  if (!resolvesAt || isEnded) { setTimeRemaining(null); return; }
  const id = setInterval(() => {
    const rem = new Date(resolvesAt).getTime() - Date.now();
    setTimeRemaining(rem);
    if (rem <= 0 || isEnded) clearInterval(id); // isEnded always reads false here
  }, 1000);
  return () => clearInterval(id);
}, [resolvesAt, isEnded]);

// ✅ Ref-synced — interval always reads the live value
const isEndedRef = useRef(isEnded);

useEffect(() => {
  isEndedRef.current = isEnded;          // sync at effect entry, before any async work
  if (!resolvesAt || isEnded) { setTimeRemaining(null); return; }
  const id = setInterval(() => {
    const rem = new Date(resolvesAt).getTime() - Date.now();
    setTimeRemaining(rem);
    if (rem <= 0 || isEndedRef.current) clearInterval(id); // reads live value
  }, 1000);
  return () => clearInterval(id);
}, [resolvesAt, isEnded]);
```

The `useRef` is declared outside the effect so it persists across renders. The sync line at the top of the effect keeps it current each time the effect re-runs. The cleanup `return () => clearInterval(id)` is still present as a safety net, but the explicit `clearInterval` inside the callback ensures timely termination independent of React's render cycle.

## Why This Matters

Without the ref, the interval installed when `isEnded=false` will never self-terminate when `isEnded` flips — it continues firing every second after the market ends. This is subtle because the interval does eventually get cleaned up by React on component unmount, but during a live session it runs indefinitely after the deadline, calling `setTimeRemaining` with increasingly negative values. The ref pattern is cheap (one ref + one assignment) and prevents the leak without adding the changing state to the effect deps (which would reinstall the interval on every state change, defeating the purpose).

## When to Apply

- Any `setInterval` or `setTimeout` callback that needs to read a React state value that can change independently of the effect's deps
- The pattern is specifically needed when you *intentionally* exclude a state from effect deps (to avoid reinstalling the interval on every change) but the callback still needs its current value

## Examples

The canonical instance in this codebase is `FeedCard.tsx` — the `isEndedRef` pattern is used by the `timeRemaining` interval to detect when the existing `isEnded` timeout has fired and cleanly self-terminate without waiting for the effect cleanup.

A related instance where this does NOT apply: the `isEnded` setTimeout effect itself reads nothing from outside state inside its callback — it only calls `setIsEnded(true)`. No stale closure risk there.

## Related

- `docs/solutions/runtime-errors/turbopack-instrumentation-worker-unref-kills-setinterval.md` — separate setInterval pitfall (unref() in Turbopack instrumentation)
- `docs/solutions/ui-bugs/video-audio-cross-layout-bleed.md` — SSR hydration safety: initialize countdown state to `null`, populate in `useEffect`
