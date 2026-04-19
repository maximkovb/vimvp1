---
status: pending
priority: p3
issue_id: "143"
tags: [code-review, architecture, scroll-adaptive-density, typescript]
dependencies: []
---

# Density type exported from useScrollVelocity creates hook→component coupling

## Problem Statement

`FeedCard.tsx` imports `Density` from `@/hooks/useScrollVelocity`. A UI component importing a type from a hook inverts the dependency direction — if the hook file is renamed, split, or replaced, `FeedCard`'s import breaks too. `Density` is shared domain vocabulary that belongs in a neutral location.

## Findings

- `src/components/FeedCard.tsx` line 9: `import type { Density } from "@/hooks/useScrollVelocity";`
- `FeedCardHandle.setDensity(density: Density)` is a consumer surface that predates the hook conceptually
- Correct direction: component defines its contract (`Density`), hook satisfies it
- Currently: hook defines `Density`, component imports from hook

## Proposed Solutions

### Option 1: Move Density to src/types/feed.ts (Recommended)

Create `src/types/feed.ts` (or add to existing barrel):
```typescript
export type Density = "minimal" | "compact" | "full";
```
Update imports in both `useScrollVelocity.ts` and `FeedCard.tsx` to `@/types/feed`.

**Pros:** Neutral location; both files depend on types, not on each other
**Cons:** New file
**Effort:** Small | **Risk:** Low

### Option 2: Define in FeedCard.tsx, re-export from hook

Define `Density` in `FeedCard.tsx` and import it in `useScrollVelocity.ts`.

**Pros:** Correct dependency direction (hook depends on component contract)
**Cons:** Slightly unusual to import a type from a component into a hook
**Effort:** Small | **Risk:** Low

## Acceptance Criteria

- [ ] `FeedCard.tsx` does not import from `@/hooks/useScrollVelocity`
- [ ] `Density` type is accessible from a neutral location
- [ ] TypeScript compiles cleanly after the move

## Work Log

- 2026-04-17: Identified by architecture-strategist in ce:review of feat/scroll-adaptive-metric-density
