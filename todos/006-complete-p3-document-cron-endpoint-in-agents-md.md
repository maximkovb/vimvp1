---
status: pending
priority: p3
issue_id: "006"
tags: [code-review, documentation, agent-native]
dependencies: []
---

# Document `GET /api/cron/poll-tiktok` in AGENTS.md

## Problem Statement

`AGENTS.md` documents the market creation pipeline, lifecycle management, and inspection endpoints — but does not mention the cron/poll endpoint or its `?force=true` parameter. Any agent or developer trying to manually trigger a poll or understand the polling system has no reference in AGENTS.md.

## Findings

- `AGENTS.md` has no mention of `GET /api/cron/poll-tiktok`
- `?force=true` parameter bypasses the 9-minute cooldown and polls all active markets immediately
- `scripts/poll-local.sh` documents the `--force` flag but AGENTS.md is the authoritative reference for routes
- The agent-native-reviewer flagged this: any action a user can take, an agent should also be able to take — and the endpoint exists specifically for agent/automation use

## Proposed Solutions

### Option 1: Add a "Polling" section to AGENTS.md (Recommended)

**Approach:** Add a new `## Polling` section after Market Inspection:

```markdown
## Polling

Manually trigger a TikTok stats poll:

- `GET /api/cron/poll-tiktok` — poll all active markets (respects 9-minute cooldown)
  Auth: `Authorization: Bearer <CRON_SECRET>`
  Returns: `{ polled, skipped, errors[], durationMs }`

- `GET /api/cron/poll-tiktok?force=true` — bypass cooldown, poll all active markets immediately
  Use for: seeding a fresh market, debugging stats, or manual trigger after outage

Helper script (local dev only): `bash scripts/poll-local.sh [--force]`
```

**Pros:**
- Completes agent-native parity documentation
- Useful for both human developers and agents
- 10-line addition

**Cons:**
- None

**Effort:** 10 minutes

**Risk:** None

## Recommended Action

Add the Polling section to AGENTS.md as described above.

## Technical Details

**Affected files:**
- `AGENTS.md` — new `## Polling` section

## Resources

- **Branch:** feat/creator-baseline-card
- **Review finding:** agent-native-reviewer (P3)
- **Helper script:** `scripts/poll-local.sh`

## Acceptance Criteria

- [ ] `GET /api/cron/poll-tiktok` documented with auth, params, and response shape
- [ ] `?force=true` parameter documented with use cases
- [ ] `scripts/poll-local.sh` referenced for local dev usage

## Work Log

### 2026-04-13 - Code Review Discovery

**By:** Claude Code (ce-review)

**Actions:**
- Confirmed cron endpoint is missing from AGENTS.md
- Drafted documentation section
