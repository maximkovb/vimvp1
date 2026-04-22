---
status: pending
priority: p2
issue_id: "102"
tags: [swr, frontend, polling, p2, code-review]
dependencies: []
---

# Extract Shared SWR Fetcher to Eliminate Duplicate HTTP Requests

Consolidate the identical `fetcher` function defined independently in two components into a single shared module reference.

## Problem Statement

`MarketLiveData.tsx` and `LiveEngagementStats.tsx` each define their own `fetcher` function at module scope with identical implementations. SWR deduplicates in-flight requests by `(key, fetcher)` identity — because the two functions are different object references, SWR treats them as separate caches. This results in two separate HTTP requests to the same endpoint every 60 seconds and breaks cross-component cache sharing.

## Findings

- `src/components/MarketLiveData.tsx:15` — defines `fetcher` at module scope
- `src/components/LiveEngagementStats.tsx:7` — defines an identical `fetcher` at module scope
- SWR key+fetcher identity check means two references = two independent request lifecycles
- Cache is not shared between the two components even when they poll the same URL
- Net effect: doubled HTTP load on the API endpoint; stale-while-revalidate benefits are halved

## Proposed Solutions

### Option 1: Extract to `src/lib/market-fetcher.ts` (recommended)

**Approach:** Create `src/lib/market-fetcher.ts` exporting a single `fetcher` function. Remove the local definitions in both components and import from the shared module.

**Pros:**
- Single source of truth for the fetcher implementation
- SWR will share the cache between both components when they use the same key + same function reference
- Cuts the polling HTTP requests to the API endpoint in half
- Easy to extend (e.g., add auth headers, error normalization) in one place

**Cons:**
- Small new file to maintain
- Requires updating two component imports

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Move fetcher to a shared context or hook

**Approach:** Wrap the SWR call in a custom hook (e.g., `useMarketLiveData`) that both components consume, sharing the hook instance via React context or by calling the same hook at a common ancestor.

**Pros:**
- More idiomatic React pattern; collocates fetching logic with usage
- Could expose loading/error state more cleanly

**Cons:**
- More refactoring surface than strictly necessary for this fix
- Context may be overkill if the components are not always co-rendered

**Effort:** 1-2 hours

**Risk:** Low-Medium

---

## Recommended Action

**To be filled during triage.** Option 1 is the minimal, correct fix. Apply after 101 is resolved.

## Technical Details

**Affected files:**
- `src/components/MarketLiveData.tsx:15` — local `fetcher` definition to remove
- `src/components/LiveEngagementStats.tsx:7` — local `fetcher` definition to remove
- `src/lib/market-fetcher.ts` — new file to create with the shared fetcher

**Related components:**
- SWR cache — benefits from shared function reference
- Any future component polling the same market endpoint will automatically share the cache

**Database changes (if any):**
- Migration needed? No

## Resources

- **Related todo:** 101 (null poll rows — fix first), 103 (tautological ternary)
- **SWR docs:** https://swr.vercel.app/docs/advanced/cache — deduplication behavior
- **Code review finding:** MarketLiveData.tsx:15, LiveEngagementStats.tsx:7

## Acceptance Criteria

- [ ] `src/lib/market-fetcher.ts` exists and exports a single `fetcher` function
- [ ] `MarketLiveData.tsx` imports `fetcher` from the shared module (no local definition)
- [ ] `LiveEngagementStats.tsx` imports `fetcher` from the shared module (no local definition)
- [ ] Network tab shows only one request per 60s interval when both components are mounted
- [ ] No regression in data rendering for either component
- [ ] Code reviewed and approved

## Work Log

### 2026-04-02 - Initial Discovery

**By:** Claude Code (code review)

**Actions:**
- Identified duplicate fetcher definitions in both components
- Confirmed SWR deduplication behavior requires referential equality on the fetcher argument
- Assessed impact: doubled HTTP requests per polling interval

**Learnings:**
- SWR's key-based dedup only works when the fetcher reference is stable and shared — module-scope definitions in separate files are always distinct references

---

## Notes

- P2: wasteful but not user-visible in the same way as 101; address after the null-row bug is fixed
- The fix is a ~3-line change in each component plus a new 5-line shared file
