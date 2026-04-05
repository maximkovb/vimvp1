---
status: pending
priority: p3
issue_id: "118"
tags: [code-review, quality, typescript]
dependencies: []
---

# Type `marketData` SWR response in BetSheet — currently untyped `any`

## Problem Statement

`BetSheet` uses `useSWR(url, fetcher)` where `fetcher` returns `Promise<any>`. The inline type annotation on the `.map()` callback (`(p: { time: string; priceYes: number })`) is not a type guard — it is a cast of `any`. If `/api/markets/[id]` changes shape, TypeScript will not catch it.

## Findings

- `src/components/BetSheet.tsx:42-47`: `marketData?.priceHistory.map((p: { time: string; priceYes: number }) => ...)`
- The inline annotation is `any`-cast, not a genuine type guard
- TypeScript agent: "If the API response changes shape, TypeScript will not catch it"

## Proposed Solutions

### Option 1: Type the SWR call with the API response shape

```ts
interface MarketApiResponse {
  priceHistory: { time: string; priceYes: number; priceNo: number }[];
  priceYes: number;
  priceNo: number;
  // add other fields as used
}

const { data: marketData } = useSWR<MarketApiResponse>(url, fetcher);
```

**Effort:** 20 minutes
**Risk:** Low

## Acceptance Criteria

- [ ] `marketData` is typed; `.map()` callback needs no inline annotation
- [ ] TypeScript error if API response shape changes incompatibly

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (kieran-typescript-reviewer agent)
