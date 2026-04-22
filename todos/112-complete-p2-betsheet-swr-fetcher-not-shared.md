---
status: pending
priority: p2
issue_id: "112"
tags: [code-review, bug, swr]
dependencies: [102]
---

# BetSheet defines its own `fetcher` — breaks SWR deduplication

## Problem Statement

`BetSheet` defines `const fetcher = (url: string) => fetch(url).then(r => r.json())` as a module-level function. This is a NEW function reference distinct from any fetcher defined elsewhere in the app. SWR uses fetcher identity as part of its cache key, so BetSheet's requests to `/api/markets/[id]` are cached separately from any other component fetching the same endpoint, causing doubled HTTP requests.

This is a documented known bug in this codebase (see todo #102 and `docs/solutions/logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md`).

## Findings

- `src/components/BetSheet.tsx:22`: `const fetcher = (url: string) => fetch(url).then((r) => r.json())`
- `src/lib/market-fetcher.ts`: project-shared fetcher exists for this purpose
- Learnings agent: "SWR cache identity is based on the fetcher function reference... If the sheet component defines `const fetcher = ...` inside its render body (or as a module-level function duplicated from another component), SWR treats it as a new cache entry and fires a separate HTTP request"
- todo #102: `swr-duplicate-fetcher-refs` — this is a recurring pattern in the codebase

## Proposed Solutions

### Option 1: Import the shared fetcher from `src/lib/market-fetcher.ts`

**Approach:**

```ts
// Remove from BetSheet.tsx:
// const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Add import:
import { fetcher } from "@/lib/market-fetcher";
```

**Pros:** SWR correctly deduplicates requests; follows established project pattern; one-line fix
**Cons:** None

**Effort:** 5 minutes
**Risk:** None

## Recommended Action

Import from the shared module. Verify `src/lib/market-fetcher.ts` exports a compatible fetcher signature.

## Technical Details

**Affected files:**
- `src/components/BetSheet.tsx:22` — remove local definition, add import

**Related:** `src/lib/market-fetcher.ts`, todo #102

## Acceptance Criteria

- [ ] BetSheet SWR requests are deduplicated with other components fetching the same market endpoint
- [ ] No duplicate network requests when opening BetSheet for a market already cached

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (learnings-researcher agent — documented known pattern)
