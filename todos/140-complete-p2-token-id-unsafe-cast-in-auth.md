---
name: token.id cast to string in auth callback — unknown type bypasses null check
description: auth.ts:98 casts token.id (unknown) as string — if JWT token arrives without id, session.user.id becomes the string "undefined"
type: bug
status: pending
priority: p2
issue_id: "140"
tags: [code-review, typescript, security, authentication]
dependencies: []
---

## Problem Statement

`src/lib/auth.ts:98` sets `session.user.id = token.id as string`. NextAuth types `token.id` as `unknown`. If a JWT is issued before the `id` field was added (e.g., old sessions), or if a Google OAuth flow doesn't seed the id, `token.id` is `undefined`, and `session.user.id` becomes the string `"undefined"`. Any auth check using `session.user.id` would then pass the truthy check but use a garbage value as the user ID.

## Findings

- **`src/lib/auth.ts:98`**: `session.user.id = token.id as string`
- `token.id` is `unknown` — the cast bypasses TypeScript's null check

## Proposed Solutions

### Option A: Add typeof guard
```ts
if (typeof token.id === "string") {
  session.user.id = token.id;
}
```
- **Effort:** Tiny (2 lines)
- **Risk:** Users with tokens that have no `id` will effectively be unauthenticated until they re-log in — correct behavior

## Acceptance Criteria
- [ ] If `token.id` is not a string, `session.user.id` is not set (remains undefined)
- [ ] Old sessions without `id` are handled gracefully (treated as unauthenticated)

## Work Log
- 2026-04-06: Identified by TypeScript reviewer during ce:review
