---
status: pending
priority: p3
issue_id: "117"
tags: [code-review, quality, typescript]
dependencies: [114]
---

# Replace `UserPosition | null | "loading"` sentinel with proper state

## Problem Statement

`BetSheet` uses `"loading"` as a string value in a `useState<UserPosition | null | "loading">` union. This mixes data shape with loading phase into one variable, makes type narrowing string-based rather than discriminant-based, and cannot be extended to include error states.

Note: if todo #114 is implemented (position moved to API response), this state may be eliminated entirely.

## Findings

- `src/components/BetSheet.tsx:34`: `useState<UserPosition | null | "loading">("loading")`
- `src/components/BetSheet.tsx:124`: `position !== "loading" && position !== null` — string comparison narrowing
- TypeScript agent: "The right approach is a discriminated union" or a separate `positionLoading: boolean` boolean
- Architecture agent recommends `positionLoading: boolean` + `position: UserPosition | null`

## Proposed Solutions

### Option 1: Dedicated loading boolean

```ts
const [position, setPosition] = useState<UserPosition | null>(null);
const [positionLoading, setPositionLoading] = useState(true);

// useEffect
setPositionLoading(true);
getUserPosition(marketId).then((pos) => {
  setPosition(pos);
  setPositionLoading(false);
});

// Render condition
{!positionLoading && position !== null && ( ... )}
```

**Effort:** 20 minutes
**Risk:** Low

### Option 2: Discriminated union

```ts
type PositionState = { status: "loading" } | { status: "idle"; position: UserPosition | null } | { status: "error"; message: string };
```

**Effort:** 30 minutes
**Risk:** Low

## Acceptance Criteria

- [ ] Position loading state expressed without string sentinels
- [ ] Type narrowing is discriminant-based

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (kieran-typescript-reviewer + architecture-strategist agents)
