---
name: AGENTS.md missing documentation for several working endpoints
description: /api/portfolio, /api/balance, /api/leaderboard, and cron resolve trigger are undocumented; pollHistory omitted from /api/markets/[id] description
type: documentation
status: pending
priority: p2
issue_id: "145"
tags: [code-review, agent-native, documentation]
dependencies: []
---

## Problem Statement

`AGENTS.md` is accurate for what it covers but has significant gaps. An agent reading the docs has no way to discover:
- `GET /api/portfolio` (returns positions, balance, PnL, recent trades)
- `GET /api/balance` (returns current balance and login streak)
- `GET /api/leaderboard` (unauthenticated, returns top 100 by total value)
- `GET /api/cron/resolve-markets` (bearer-token triggered bulk resolution)
- `GET /api/markets/[id]` description omits `pollHistory` (added in todo #043)
- No section on trading API (even to document it doesn't exist yet)

## Findings

- **`AGENTS.md`**: Missing 4 endpoints; one existing endpoint has incomplete description
- Agent-native-reviewer: "An agent reading AGENTS.md has no way to discover them"

## Proposed Solutions

### Option A: Update AGENTS.md with all current endpoints
Add sections for:
- `GET /api/portfolio` — auth: session only (note bearer limitation)
- `GET /api/balance` — auth: session only
- `GET /api/leaderboard` — auth: none, returns rank/name/balance/totalValue
- `GET /api/cron/resolve-markets` — auth: bearer, triggers bulk resolution
- Update `GET /api/markets/[id]` to include `pollHistory` in response schema
- Add "Trading" section noting no REST API exists yet (links to todo #127)

- **Effort:** Small (documentation update)
- **Risk:** None

## Acceptance Criteria
- [ ] All 4 missing endpoints documented
- [ ] `pollHistory` mentioned in `/api/markets/[id]` response schema
- [ ] Trading limitation explicitly documented with workaround or future todo reference

## Work Log
- 2026-04-06: Identified by agent-native-reviewer during ce:review
