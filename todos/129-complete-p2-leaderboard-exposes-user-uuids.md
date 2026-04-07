---
name: Leaderboard exposes internal user UUIDs to unauthenticated callers
description: GET /api/leaderboard returns user.id (internal UUID) to anyone — enables enumeration and PII linkage
type: bug
status: pending
priority: p2
issue_id: "129"
tags: [code-review, security, privacy, api]
dependencies: []
---

## Problem Statement

`GET /api/leaderboard` returns `{ id: "uuid", name: "Real Name", balance, ... }` with no authentication. Exposing internal UUIDs allows unauthenticated callers to collect user IDs for correlation with other endpoints or logs. Real names from Google OAuth are also returned, which may raise GDPR/CCPA concerns.

## Findings

- **`src/app/api/leaderboard/route.ts:11-21`**: `users.id` included in SELECT and returned in response to unauthenticated callers

## Proposed Solutions

### Option A: Omit `id` from leaderboard response (Recommended)
Replace the `id` field with an opaque `rank` number. Names are acceptable for a public leaderboard, but internal UUIDs should not be exposed.
- **Effort:** Tiny
- **Risk:** None — check callers of the leaderboard API don't use `id`

## Acceptance Criteria
- [ ] `GET /api/leaderboard` response does not include `id` field
- [ ] Rank is conveyed via array index or explicit `rank` field

## Work Log
- 2026-04-06: Identified by security-sentinel during ce:review
