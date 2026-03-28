---
status: pending
priority: p1
issue_id: "070"
tags: [code-review, agent-native, architecture, api]
dependencies: ["065"]
---

# Extract `generateMarketSuggestion` core logic into a service helper — Phase 2 API route always returns 501

## Problem Statement

`POST /api/admin/market-suggestion` (added in #065) unconditionally returns HTTP 501. The route authenticates via `verifyCronAuth`, validates input, then calls `generateMarketSuggestion()` — a server action that immediately calls `auth()` and returns `{ error: "Unauthorized" }` because no browser session exists in an API route context. The 501 branch is always hit.

This means the three-step agent pipeline documented in `AGENTS.md` has no working Phase 2. An agent must supply all contract parameters manually to `POST /api/markets` without LLM calibration or channel analytics.

## Findings

- `src/app/api/admin/market-suggestion/route.ts` line 60: calls `generateMarketSuggestion(parsed.data)`
- `src/lib/actions/admin.ts` line 187: `const session = await auth(); if (!isAdmin(session)) return { error: "Unauthorized" };`
- No browser session exists in an API route handler context → auth check always fails → 501 always returned
- `docs/solutions/integration-issues/anthropic-claude-api-nextjs-server-action.md` Pattern 3 documents this exact anti-pattern: "Calling a server action from another layer is a red flag — extract shared logic into plain async utilities"
- The `GET /api/admin/video-stats` route is the correct model: it duplicates the core YouTube fetch logic inline, authenticated separately

## Proposed Solution

Extract the body of `generateMarketSuggestion()` below the `auth()` check into a standalone async function:

```typescript
// src/lib/services/marketSuggestion.ts  (new file)
export async function computeMarketSuggestion(input: {
  videoId: string; title: string; channelId: string; channelTitle: string;
  publishedAt: string; categoryId?: string; viewCount: number; likeCount: number;
}) {
  // All current logic from generateMarketSuggestion below the auth() check:
  // - YouTube channel API calls
  // - Statistical computation (mean, stddev)
  // - LLM call with algorithmic fallback
  // - Return { contract, suggestedTitle, videoAgeHours, subscriberCount, channelAvgViews, duplicateWarning }
}
```

```typescript
// src/lib/actions/admin.ts — server action becomes a thin wrapper
export async function generateMarketSuggestion(input) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };
  return computeMarketSuggestion(input);
}

// src/app/api/admin/market-suggestion/route.ts — API route calls service directly
const result = await computeMarketSuggestion(parsed.data);
```

**Pros:** Unblocks the full agent pipeline; clean separation of auth from business logic; matches existing pattern from `video-stats` route.
**Cons:** Medium refactor; must ensure no accidental auth bypass.
**Risk:** Low — same logic, same inputs. The `auth()` gate stays in the server action wrapper.

- **Effort**: Medium
- **Risk**: Low

## Acceptance Criteria

- [ ] `POST /api/admin/market-suggestion` with valid `CRON_SECRET` returns a full suggestion (contract + suggestedTitle + calibration data) instead of 501
- [ ] The server action `generateMarketSuggestion()` still returns `{ error: "Unauthorized" }` for non-admin sessions
- [ ] The TODO comment in `market-suggestion/route.ts` is resolved
- [ ] AGENTS.md Phase 2 note is updated to remove the "currently requires..." limitation
- [ ] TypeScript compiles clean

## Work Log

- 2026-03-27: Identified during `/ce:review` — architecture-strategist (P1-A), security-sentinel (P1-1), agent-native-reviewer (P1-1), learnings-researcher (Pattern 3 match)
