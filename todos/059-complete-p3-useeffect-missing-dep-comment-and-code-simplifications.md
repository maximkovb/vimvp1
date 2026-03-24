---
status: complete
priority: p3
issue_id: "059"
tags: [code-review, typescript, react, simplicity, market-creation]
---

# Minor simplifications: useEffect dep comment, milestoneMin alias, duplicate parseInt, inline floor

## Problem Statement

Four small quality issues introduced in commit cac047a. None are correctness bugs on their own but each adds carrying cost or could cause a future regression.

## Findings

### 1. `useEffect` missing dep comment (`page.tsx:98–103`)

`milestoneThreshold` is read inside the effect but intentionally absent from the dep array. Without a comment, `eslint-plugin-react-hooks` will flag this and a future maintainer may add `milestoneThreshold` to the array — which would make the effect re-fire on every slider move. This should be suppressed with an explanatory comment:

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
// milestoneThreshold is read for comparison only — adding it would re-fire on every
// slider move. This effect should only run when the floor itself changes.
}, [questionType, milestoneFloor]);
```

### 2. `milestoneMin` alias adds a redundant name (`page.tsx:89`)

```ts
const milestoneFloor = contractLoaded ? computeMilestoneFloor(...) : 0;
const milestoneMin = milestoneFloor;  // ← same value, different name
```

`milestoneMin` is only used in JSX min/max display and `handleResolutionButton`. Using `milestoneFloor` directly everywhere removes one name to track. Minor but consistent with the codebase's otherwise lean variable usage.

### 3. Double `parseInt` for view/like counts in `admin.ts` (lines 281–282 + 350–351)

Both parse the same `formData.get("initialViewCount")` field. The first pair uses the "Raw" suffix but is used directly (no further transformation). The second pair drops the suffix. Consolidating to one parse reduces redundancy and makes it impossible for the two parses to diverge.

### 4. Inline floor in `handleFetchVideo` doesn't call the helper (`page.tsx:141`)

```ts
const fetchFloor = Math.ceil(result.viewCount * 1.2);  // only the analytics component
```

This reimplements half the floor formula rather than calling `computeMilestoneFloor(result.contract.milestoneThreshold, result.viewCount)`. The omission of the `0.1× anchor` component may be intentional (at fetch time the anchor state isn't set yet), but it should either call the helper or have a comment explaining the difference.

## Proposed Solutions

### All four in one pass (Recommended)

1. Add `eslint-disable-next-line` comment above the useEffect closing bracket
2. Remove `milestoneMin`, replace all usages with `milestoneFloor`
3. In `admin.ts`: delete lines 350–351 (second parse), rename `initialViewCountRaw` → `initialViewCount` throughout
4. In `handleFetchVideo`: either call `computeMilestoneFloor(result.contract.milestoneThreshold, result.viewCount)` or add a `// Uses only the analytics component — anchor not yet set` comment

**Effort:** Small (~10 lines changed)

## Acceptance Criteria

- [ ] `eslint-plugin-react-hooks` does not warn on the useEffect dep array (suppressed with comment)
- [ ] `milestoneMin` variable removed, `milestoneFloor` used directly
- [ ] `parseInt` for view/like counts appears once in `admin.ts`, used in both floor guard and poll seed
- [ ] `handleFetchVideo` floor calculation either calls the helper or has an explanatory comment

## Work Log

- 2026-03-24: Found by performance-oracle + kieran-typescript-reviewer + code-simplicity-reviewer during code review of commit cac047a
