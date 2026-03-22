---
status: pending
priority: p2
issue_id: "013"
tags: [code-review, architecture, agent-native]
dependencies: []
---

# Add JSON API Read Endpoints for Agent-Native Parity

## Problem Statement

All read operations (markets list, single market, portfolio, leaderboard) are server-rendered HTML pages with no JSON API equivalent. An agent (or any programmatic client) that calls `buyShares` cannot first fetch market state or user balance — these require scraping HTML. This also means the app scores 0/4 on programmatic read access, blocking any automation or trading bot use cases.

## Findings

- Agent-native review: 4 of 8 user capabilities have programmatic access; 0 of 4 read flows do
- `/` page: queries markets table server-side, returns HTML
- `/markets/[id]` page: queries market + trades + priceSnapshots, returns HTML
- `/portfolio` page: queries user balance + positions + trades, returns HTML
- `/leaderboard` page: queries users ranked by total value, returns HTML
- No `GET /api/markets`, no `GET /api/markets/[id]`, no `GET /api/portfolio`, no `GET /api/leaderboard`
- `previewTrade` exists as a server action but there's no way to discover available markets to preview for

## Proposed Solutions

### Option 1: Add Minimal API Routes

**Approach:** Create four route handlers that extract the existing DB queries from page components:

```
src/app/api/markets/route.ts          — GET, public, returns active markets with prices
src/app/api/markets/[id]/route.ts     — GET, public, returns single market state
src/app/api/portfolio/route.ts        — GET, authenticated, returns balance + positions
src/app/api/leaderboard/route.ts      — GET, public, returns top 100 users
```

Each route calls `auth()`, runs the same queries as the page, returns `NextResponse.json(data)`.

**Pros:** Immediate agent accessibility; reuses existing DB query logic; no new data layer needed
**Cons:** Some duplication of query logic between pages and API routes (can be extracted to shared functions)

**Effort:** 3-4 hours
**Risk:** Low

---

### Option 2: Extract Queries to Shared Data Layer

**Approach:** Extract all DB queries into `src/lib/data/` functions, call them from both pages and API routes.

**Pros:** No duplication; cleaner architecture
**Cons:** More upfront refactoring

**Effort:** 6-8 hours
**Risk:** Low

## Recommended Action

Option 1 as the immediate path; refactor to Option 2 if the data layer grows.

## Technical Details

**Files to create:**
- `src/app/api/markets/route.ts`
- `src/app/api/markets/[id]/route.ts`
- `src/app/api/portfolio/route.ts` (requires auth)
- `src/app/api/leaderboard/route.ts`

**Minimum response shape for markets:**
```typescript
{ id, title, status, questionType, milestoneThreshold, priceYes, priceNo, resolvesAt, videoMetadata }
```

**Minimum response shape for portfolio:**
```typescript
{ balance, positions: [{ marketId, outcome, shares, avgCostBasis, currentPrice, marketTitle }], recentTrades: [...] }
```

## Acceptance Criteria

- [ ] `GET /api/markets` returns JSON list of active/halted markets with current prices
- [ ] `GET /api/markets/[id]` returns single market state including price history
- [ ] `GET /api/portfolio` returns authenticated user's balance and open positions
- [ ] `GET /api/leaderboard` returns ranked user list as JSON
- [ ] Unauthenticated access to `/api/portfolio` returns 401
- [ ] Response shapes are documented (in code comments or a README section)

## Work Log

### 2026-03-22 - Discovery

**By:** Agent-native reviewer (code review)
