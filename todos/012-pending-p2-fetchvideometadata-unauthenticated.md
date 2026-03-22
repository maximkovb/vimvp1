---
status: pending
priority: p2
issue_id: "012"
tags: [code-review, security]
dependencies: ["011"]
---

# Restrict fetchVideoMetadata to Authenticated Admins

## Problem Statement

`fetchVideoMetadata` is exported as a `"use server"` action with no authentication check. Any user (authenticated or not) can invoke it, consuming YouTube API quota and receiving information about arbitrary video IDs. This is a minor SSRF surface (destination is hardcoded to googleapis.com but video ID is user-controlled) and a quota exhaustion vector.

## Findings

- `src/lib/actions/admin.ts:29`: `fetchVideoMetadata` has no `auth()` check at all
- The function is called from `createMarket` (which IS admin-gated) AND is exported separately for the admin form's "Fetch Metadata" button
- An unauthenticated caller can enumerate YouTube video IDs and check their existence
- YouTube Data API v3: 10,000 units/day quota; each call costs 1 unit; unlimited unauthenticated calls drain quota
- The video ID is validated by `extractVideoId()` regex before use, limiting SSRF to well-formed YouTube IDs

## Proposed Solutions

### Option 1: Add Admin Auth Check

**Approach:** Add authentication at the top of `fetchVideoMetadata`:

```typescript
export async function fetchVideoMetadata(url: string) {
  const session = await auth();
  if (!isAdmin(session)) return { error: "Unauthorized" };
  // ... rest of function
}
```

**Pros:** One-line fix; consistent with other admin actions
**Cons:** None

**Effort:** 15 minutes
**Risk:** Low

## Recommended Action

Option 1. Straightforward fix.

## Technical Details

**Affected files:**
- `src/lib/actions/admin.ts:29-57` — add auth check at top of `fetchVideoMetadata`

## Acceptance Criteria

- [ ] `fetchVideoMetadata` returns `{ error: "Unauthorized" }` for unauthenticated callers
- [ ] Admin users can still use the Fetch Metadata button in the create market form
- [ ] Quota exhaustion via unauthenticated calls is no longer possible

## Work Log

### 2026-03-22 - Discovery

**By:** Security sentinel (code review)
