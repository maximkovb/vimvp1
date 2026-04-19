---
status: pending
priority: p3
issue_id: "007"
tags: [code-review, architecture, duplication]
dependencies: []
---

# Extract `useMarketData` Shared Hook to Eliminate Duplicate SWR Config

## Problem Statement

`MarketLiveData.tsx` and `LiveEngagementStats.tsx` both contain identical SWR configuration (same key pattern, same `marketFetcher`, same adaptive `refreshInterval` logic). This duplication means any change to polling behavior (intervals, fetcher, error handling) must be applied in two places.

## Findings

- `src/components/MarketLiveData.tsx:24–34` — `useSWR` with adaptive `refreshInterval`
- `src/components/LiveEngagementStats.tsx:13–24` — identical `useSWR` configuration
- Both use `marketFetcher` from `@/lib/market-fetcher`
- Both use the same adaptive interval: `halted || resolving → 10_000, else 60_000`
- Both fall back to `initialData`
- SWR deduplicates requests automatically (same key = same cache entry), but the config duplication is still a maintenance risk

## Proposed Solutions

### Option 1: Extract `useMarketData(marketId, initialData)` hook

**Approach:** Create `src/hooks/useMarketData.ts`:

```typescript
export function useMarketData(marketId: string, initialData: MarketData) {
  return useSWR<MarketData>(
    `/api/markets/${marketId}`,
    marketFetcher,
    {
      refreshInterval: (latestData) => {
        const status = latestData?.status ?? initialData.status;
        return status === "halted" || status === "resolving" ? 10_000 : 60_000;
      },
      fallbackData: initialData,
    }
  );
}
```

Then use in both components: `const { data } = useMarketData(marketId, initialData);`

**Pros:**
- Single source of truth for polling config
- Future changes (error handling, retry logic, intervals) in one place
- Consistent behavior guaranteed across components

**Cons:**
- New file for a small abstraction; arguably YAGNI for 2 components

**Effort:** 30 minutes

**Risk:** None

---

### Option 2: Leave as-is, add comment noting the duplication

**Approach:** Add `// Keep in sync with LiveEngagementStats.tsx` comment.

**Pros:**
- Zero code change

**Cons:**
- Doesn't prevent drift; comments get stale

**Effort:** 2 minutes

**Risk:** Low short-term, medium long-term

## Recommended Action

Option 1 if more components will use market data in the future. Option 2 is acceptable if these are the only two consumers and no new components are planned.

## Technical Details

**Affected files:**
- `src/hooks/useMarketData.ts` — new file
- `src/components/MarketLiveData.tsx` — replace useSWR call
- `src/components/LiveEngagementStats.tsx` — replace useSWR call

## Resources

- **Branch:** feat/creator-baseline-card
- **Review finding:** architecture-strategist / code-simplicity-reviewer (P3)

## Acceptance Criteria

- [ ] `useMarketData` hook created in `src/hooks/`
- [ ] Both `MarketLiveData` and `LiveEngagementStats` use the hook
- [ ] Adaptive interval logic exists in exactly one place
- [ ] TypeScript compiles without errors

## Work Log

### 2026-04-13 - Code Review Discovery

**By:** Claude Code (ce-review)

**Actions:**
- Identified duplicate SWR configuration in two components
- Assessed deduplication opportunity
- Noted this is P3 — safe to defer if scope is stable
