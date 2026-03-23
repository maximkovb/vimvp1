---
status: pending
priority: p1
issue_id: "026"
tags: [code-review, agent-native, api, architecture]
dependencies: []
---

# No REST API for Market Creation — Entire Write Path Locked Out from Agents

## Problem Statement

All five admin write operations (fetch video, create market, publish draft, cancel, manual resolve) are exclusively accessible via Next.js server actions that require a `auth()` session cookie from a browser login flow. There is no REST endpoint, no API key auth path, and no way for a programmatic client (CI seeder, LLM agent, admin script) to call any write operation. `GET /api/markets` and `GET /api/markets/[id]` exist but are read-only. The contract recommendation data (LLM reasoning, calibrated parameters) is only consumable inside the React component. 0 of 5 admin write capabilities are agent-accessible.

## Findings

- `src/app/api/markets/route.ts` — only `GET` handler exists; no `POST`
- `src/lib/actions/admin.ts:173` — `createMarket()` requires FormData + session cookie
- `src/lib/actions/admin.ts:41` — `fetchVideoMetadata()` requires session cookie
- `src/lib/cron-auth.ts` — existing bearer token auth pattern that can be reused for admin API

## Proposed Solutions

### Option 1: Add `POST /api/markets` with bearer token auth (Recommended)

```typescript
// src/app/api/markets/route.ts — add POST handler
export async function POST(req: Request) {
  // Validate admin API key
  const { valid } = verifyCronAuth(req); // reuse existing cron-auth pattern
  if (!valid) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  // Validate with Zod, call fetchVideoMetadata + createMarket logic
  // Return { marketId, contract }
}
```

**Pros:** Unblocks all programmatic workflows; reuses existing `verifyCronAuth` pattern; clean REST contract
**Cons:** Exposes admin write capability via HTTP — API key rotation policy needed
**Effort:** Medium
**Risk:** Low (gated by API key)

---

### Option 2: Add `POST /api/admin/markets` as a separate admin API namespace

Keep admin API endpoints under `/api/admin/` to distinguish from public market endpoints.

**Pros:** Clear separation of public vs admin API
**Cons:** Additional route file
**Effort:** Medium
**Risk:** Low

## Recommended Action

Option 1 — add `POST /api/markets` initially. Can move to `/api/admin/markets` when other admin endpoints are added.

Also add: `PATCH /api/markets/[id]` for lifecycle transitions (publish, cancel, resolve).

## Technical Details

**Affected files:**
- `src/app/api/markets/route.ts` — add `POST` handler
- `src/lib/cron-auth.ts` — reuse `verifyCronAuth` for admin API key validation
- `src/types/` — add `CreateMarketInput` interface shared between server action and REST handler

## Acceptance Criteria

- [ ] `POST /api/markets` with valid `Authorization: Bearer <ADMIN_API_KEY>` returns `201 { marketId, contract }`
- [ ] `POST /api/markets` with no/invalid bearer token returns `401`
- [ ] `POST /api/markets` with missing required fields returns `400` with field-level errors
- [ ] `POST /api/markets` with invalid YouTube URL returns `400 Invalid YouTube URL`
- [ ] Response body includes full `contract` recommendation (milestoneThreshold, bParameter, resolutionHours, riskTier, and reasoning if LLM path was used)
- [ ] Created market appears in `GET /api/markets` response

## Work Log

### 2026-03-23 - Discovery

**By:** Agent-Native Reviewer (code review agent)
