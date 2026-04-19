---
status: pending
priority: p3
issue_id: "145"
tags: [code-review, architecture, scroll-adaptive-density, documentation]
dependencies: []
---

# useScrollVelocity has three undocumented constraints that will surprise future developers

## Problem Statement

Three implicit assumptions in `useScrollVelocity` are not documented and will cause subtle bugs or confusion if violated:

1. **Desktop guard is mount-time only** — `window.matchMedia` is evaluated once when the effect runs. Resizing from desktop to mobile mid-session leaves the hook dormant (no listener attached).
2. **`scrollRef` must be stable** — the `[scrollRef]` dependency means the effect never re-runs if the underlying DOM node changes. If `feedColumnRef` is ever conditionally rendered, listeners attach to the old node silently.
3. **`el!` non-null assertion is redundant** — `el` is checked with `if (!el) return` two lines above; the `!` is unnecessary noise that looks like it's suppressing a real nullability concern.

Additionally, `typeof window !== "undefined"` inside a `useEffect` is always `true` in a browser context — this check is only meaningful in SSR (Node.js), but `useEffect` never runs server-side. The check is harmless but misleading.

## Findings

- `src/hooks/useScrollVelocity.ts` line 22: `typeof window !== "undefined" && window.matchMedia(...)` — inside `useEffect`, always true in browser
- `src/hooks/useScrollVelocity.ts` line 55: `const scrollTop = el!.scrollTop` — `el` already narrowed to non-null by the early return
- `src/hooks/useScrollVelocity.ts` line 100: `}, [scrollRef])` — mount-only; DOM node changes not detected
- `src/hooks/useScrollVelocity.ts` lines 21–24: matchMedia evaluated once at mount; no resize listener

## Proposed Solutions

### Option 1: Add comments + remove redundant checks (Recommended)

```typescript
// Remove typeof window check (useEffect never runs server-side):
if (window.matchMedia("(min-width: 1024px)").matches) {
  // Desktop: side HUD always shows full data. Guard is mount-time only —
  // viewport resize from desktop → mobile mid-session will not enable the hook.
  return;
}

// Use el directly (already narrowed by early return above):
const scrollTop = el.scrollTop;

// Document scrollRef assumption:
// scrollRef must reference a stable DOM node. If the element is ever conditionally
// rendered or swapped, re-mount the parent to re-run this effect.
}, [scrollRef]);
```

**Pros:** Zero behavior change; improves readability and maintainability
**Cons:** None
**Effort:** Small | **Risk:** None

### Option 2: Add viewport resize listener for desktop guard

Add a `matchMedia` change listener to re-evaluate the desktop guard if the viewport crosses the breakpoint:

```typescript
const mq = window.matchMedia("(min-width: 1024px)");
if (mq.matches) return;
// ... attach scroll listeners
mq.addEventListener("change", () => { /* re-run effect */ });
```

**Pros:** Handles viewport resize correctly
**Cons:** More complex; the use case (desktop → mobile resize mid-session) is vanishingly rare in production
**Effort:** Medium | **Risk:** Low

## Acceptance Criteria

- [ ] `el!` non-null assertion removed; `el` used directly after the early-return guard
- [ ] `typeof window !== "undefined"` removed from the useEffect body
- [ ] Comment added above matchMedia check documenting mount-time evaluation limitation
- [ ] Comment added above `[scrollRef]` dependency explaining stability assumption

## Work Log

- 2026-04-17: Identified by security-sentinel + architecture-strategist + kieran-typescript-reviewer in ce:review of feat/scroll-adaptive-metric-density
