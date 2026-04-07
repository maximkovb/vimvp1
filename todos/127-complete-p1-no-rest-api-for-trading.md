---
name: No REST API for trading — agents cannot buy/sell shares
description: buyShares and sellShares are Server Actions only with no bearer-token REST equivalents, blocking all agent-based trading
type: feature
status: pending
priority: p1
issue_id: "127"
tags: [code-review, agent-native, api, trading]
dependencies: []
---

## Problem Statement

`buyShares` and `sellShares` in `src/lib/actions/trade.ts` use `auth()` (session-based) with no REST equivalents. An agent cannot participate in the core mechanic of the app — markets can be created, read, and resolved via API, but no bearer-token route exists to trade. Agents are read-only observers.

**Why:** Trading was implemented as Server Actions for the UI first; agent-accessible REST was not added.

## Findings

- **`src/lib/actions/trade.ts:88`** (`buyShares`) — Server Action only, no route
- **`src/lib/actions/trade.ts:255`** (`sellShares`) — Server Action only, no route
- **`src/lib/actions/trade.ts:42`** (`previewTrade`) — Server Action only, no quote endpoint
- Agent-native-reviewer score: 1 of 6 write capabilities are agent-accessible

## Proposed Solutions

### Option A: Add POST /api/trades and GET /api/markets/[id]/quote
```ts
// POST /api/trades
// Body: { action: "buy" | "sell", marketId, outcome, amount? (buy), shares? (sell) }
// Auth: Authorization: Bearer <CRON_SECRET>
// Implementation: reuse logic from buyShares/sellShares Server Actions

// GET /api/markets/[id]/quote?outcome=0&amount=100
// Auth: none (read-only LMSR computation from market state)
// Implementation: reuse previewTrade logic
```
- **Effort:** Medium
- **Risk:** Low — existing logic is well-tested; just wrapping it

### Option B: Accept agents as read-only for now
- **Effort:** None
- **Risk:** Blocks any agent-based market-making or automated trading strategy

## Acceptance Criteria
- [ ] `POST /api/trades` accepts bearer token, executes buy or sell, returns `{ shares, cost }` or `{ refund }`
- [ ] `GET /api/markets/[id]/quote` returns price preview without DB write
- [ ] AGENTS.md updated with new endpoint documentation
- [ ] Trade endpoint rate-limited (or relies on optimistic lock retries)

## Work Log
- 2026-04-06: Identified by agent-native-reviewer during ce:review
