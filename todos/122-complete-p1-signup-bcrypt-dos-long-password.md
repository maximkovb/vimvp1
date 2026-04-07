---
name: signUp bcrypt DoS via long password
description: signUp server action has no password length cap — bcrypt.hash with 100KB input blocks the event loop for seconds
type: bug
status: pending
priority: p1
issue_id: "122"
tags: [code-review, security, authentication, dos]
dependencies: []
---

## Problem Statement

`src/lib/actions/auth.ts` reads `password` from FormData with only a `length < 8` lower-bound check and no upper-bound cap. `bcrypt.hash(password, 12)` is intentionally CPU-intensive. A 1MB password string causes bcrypt to run for many seconds, blocking the Node.js event loop and degrading the entire serverless function. bcryptjs also silently truncates at 72 bytes — passwords over 72 chars add no security but enable DoS.

Additionally, `name` and `email` have no length caps — a 10MB `name` will be stored in Postgres.

**Why:** Initial implementation validated only the minimum password length.

## Findings

- **`src/lib/actions/auth.ts:12-14`**: Only `password.length < 8` check, no max. `name` and `email` uncapped.

## Proposed Solutions

### Option A: Add length caps and email format validation
```ts
if (password.length > 72) return { error: "Password too long" };
if (name.length > 100) return { error: "Name too long" };
if (email.length > 254) return { error: "Invalid email" };
// Basic email format check
if (!email.includes("@")) return { error: "Invalid email format" };
```
- **Effort:** Small
- **Risk:** None

## Acceptance Criteria
- [ ] Password capped at 72 characters with clear error message
- [ ] Name capped at 100 characters
- [ ] Email capped at 254 characters with basic format validation

## Work Log
- 2026-04-06: Identified by security-sentinel during ce:review
