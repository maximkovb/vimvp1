---
status: pending
priority: p2
issue_id: "103"
tags: [frontend, ux, p2, code-review]
dependencies: []
---

# Remove Tautological Ternary in LastUpdated Timestamp Display

Simplify the no-op ternary that passes the same value in both branches to `LastUpdated`, removing dead code and making the intent clear.

## Problem Statement

`MarketLiveData.tsx:78` passes `updatedAt` to the `LastUpdated` component via a ternary where both branches evaluate to the same value (`lastFetched`). The `isValidating` flag has no effect on what gets rendered, making the UI appear broken or misleadingly stale even when polling is working correctly.

```tsx
// current (broken)
<LastUpdated updatedAt={isValidating ? lastFetched : lastFetched} />

// intended (simplified)
<LastUpdated updatedAt={lastFetched} />
```

## Findings

- `src/components/MarketLiveData.tsx:78` — ternary `isValidating ? lastFetched : lastFetched` is logically a no-op
- `isValidating` is imported/tracked but has no actual effect on this render path
- The original intent was likely to show a different value (e.g., `undefined` or a loading placeholder) while revalidating, but both branches were set to `lastFetched`
- Result: the `LastUpdated` component always receives `lastFetched`, but the dead ternary obscures intent and may have masked a genuine UX decision that was never implemented

## Proposed Solutions

### Option 1: Simplify to `updatedAt={lastFetched}` (recommended)

**Approach:** Replace the tautological ternary with a direct prop pass: `<LastUpdated updatedAt={lastFetched} />`.

**Pros:**
- Removes dead code and makes intent obvious
- No behavior change (same value was always passed)
- Eliminates reader confusion about whether `isValidating` was supposed to do something

**Cons:**
- None for the direct simplification

**Effort:** 5 minutes

**Risk:** Low

---

### Option 2: Implement the intended validating UX (if desired)

**Approach:** Decide what `LastUpdated` should show while SWR is revalidating — e.g., pass `undefined` to show a spinner, or pass the previous `lastFetched` to keep the old timestamp visible. Then implement correctly:

```tsx
<LastUpdated updatedAt={isValidating ? undefined : lastFetched} />
```

**Pros:**
- Delivers the UX polish that was likely the original intent

**Cons:**
- Requires a product decision on desired behavior
- Slightly more scope

**Effort:** 30-60 minutes (including design decision)

**Risk:** Low

---

## Recommended Action

**To be filled during triage.** Apply Option 1 immediately to remove the dead code. If the team wants a "refreshing..." indicator during revalidation, track that as a separate UX enhancement.

## Technical Details

**Affected files:**
- `src/components/MarketLiveData.tsx:78` — the tautological ternary

**Related components:**
- `LastUpdated` — receives `updatedAt`; behavior unchanged by this fix
- `isValidating` — SWR flag that is currently unused at this call site after the fix

**Database changes (if any):**
- Migration needed? No

## Resources

- **Related todo:** 101 (null poll rows), 102 (SWR duplicate fetcher refs)
- **Code review finding:** MarketLiveData.tsx:78

## Acceptance Criteria

- [ ] `MarketLiveData.tsx:78` no longer contains the tautological ternary
- [ ] `LastUpdated` renders the correct `lastFetched` timestamp as before
- [ ] No regression in timestamp display
- [ ] Code reviewed and approved

## Work Log

### 2026-04-02 - Initial Discovery

**By:** Claude Code (code review)

**Actions:**
- Identified tautological ternary at MarketLiveData.tsx:78
- Confirmed both branches evaluate to `lastFetched` — no behavioral difference
- Noted `isValidating` is otherwise unused at this call site

**Learnings:**
- Likely a copy-paste or incomplete refactor; the original intent may have been to show a loading state during SWR revalidation

---

## Notes

- Trivial fix; safe to bundle with other MarketLiveData.tsx changes from 102
- If a revalidating UX state is desired, open a separate UX task rather than extending this one
