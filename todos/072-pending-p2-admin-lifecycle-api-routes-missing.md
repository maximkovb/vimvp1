---
status: pending
priority: p2
issue_id: "072"
tags: [code-review, agent-native, api]
dependencies: ["070"]
---

# Admin lifecycle actions have no bearer-token API routes — agents cannot publish, cancel, or resolve markets

## Problem Statement

Agents can create markets (draft or published) via `POST /api/markets`, but the rest of the admin lifecycle is inaccessible without a browser session. An agent that creates a draft cannot promote it. An agent that detects a duplicate market cannot cancel it. An agent monitoring for stuck `resolving` or `failed` markets cannot intervene.

Current score: **3 of 8 admin capabilities are agent-accessible.**

## Findings

From the agent-native-reviewer capability map:

| UI Action | Server Action | Agent Route | Status |
|---|---|---|---|
| Publish draft | `publishMarket()` in `admin.ts:487` | None | Missing |
| Cancel market | `cancelMarket()` in `admin.ts:520` | None | Missing |
| Manual resolve | `manualResolve()` in `admin.ts:553` | None | Missing |
| List all markets (incl. drafts) | Admin page query | None | Missing |

Impact:
- AGENTS.md documents draft creation as an agent capability ("agents can use it to stage markets for review") but there is no API route to complete the workflow
- The duplicate warning from Phase 2 suggestion is informational only — agents cannot act on it
- Markets stuck in `resolving` or `failed` status require manual browser intervention even if an agent detects the condition

## Proposed Solution

Add four bearer-token-authenticated routes:

```typescript
// PATCH /api/admin/markets/[id]/publish  — promote draft → active
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;
  const { id } = await params;
  // validate UUID, call publishMarket core logic, return updated market
}

// DELETE /api/markets/[id]  — cancel/void a market
// POST /api/admin/markets/[id]/resolve  — manual resolve { outcome: 0 | 1 }
// GET /api/admin/markets  — list all markets including drafts
```

Each route calls the same underlying DB logic as the server action, with `verifyCronAuth` replacing `auth() + isAdmin()`.

- **Effort**: Medium
- **Risk**: Low — bearer-token auth already established; same DB operations as existing server actions

## Acceptance Criteria

- [ ] `PATCH /api/admin/markets/[id]/publish` promotes a draft market to active
- [ ] `DELETE /api/markets/[id]` (or equivalent) cancels/voids a market
- [ ] `POST /api/admin/markets/[id]/resolve` with `{ outcome: 0 | 1 }` manually resolves a market
- [ ] `GET /api/admin/markets` returns all markets including `draft` status
- [ ] All four routes return 401 without valid `CRON_SECRET` bearer token
- [ ] AGENTS.md documents all four new routes
- [ ] AGENTS.md draft-creation section notes the publish route is now available

## Work Log

- 2026-03-27: Identified during `/ce:review` — agent-native-reviewer (P1-2, P1-3, P1-4, P2-5)
