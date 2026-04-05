---
status: pending
priority: p2
issue_id: "113"
tags: [code-review, security, auth]
dependencies: []
---

# Add `/profile` to middleware matcher

## Problem Statement

`/profile` requires authentication but is not in the `middleware.ts` matcher. Auth gating relies solely on the in-page RSC redirect (`if (!session?.user) redirect("/auth/signin")`). This creates an inconsistency with `/portfolio` which IS in the middleware matcher, and leaves the profile page as a defense-in-depth-only gate rather than a primary gate.

## Findings

- `src/middleware.ts:14-16`: matcher covers `/admin/:path*` and `/portfolio/:path*` — `/profile` absent
- `src/app/profile/page.tsx:10`: `if (!session?.user) redirect("/auth/signin")` — RSC-level redirect only
- Security agent: "The pattern creates an inconsistency... if Next.js edge caching, a CDN, or a future middleware change intercepts the request before the RSC runs, the page could be partially served"
- Also: `src/app/profile/page.tsx:15`: `session.user.id!` non-null assertion — if the redirect on line 10 is bypassed, this throws rather than redirecting gracefully
- Learnings agent: per `docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md` — "Auth checks in server components are defense-in-depth, not the primary gate. The primary gate must be in middleware."

## Proposed Solutions

### Option 1: Add `/profile` to middleware matcher

**Approach:**

```ts
// src/middleware.ts
matcher: ["/admin/:path*", "/portfolio/:path*", "/profile/:path*"],
```

**Pros:** Consistent with how other protected routes are guarded; unauthenticated requests are redirected at the edge before any RSC runs
**Cons:** None

**Effort:** 5 minutes
**Risk:** None

## Recommended Action

Add the matcher entry. Also consider replacing the `session.user.id!` assertion with an explicit guard.

## Technical Details

**Affected files:**
- `src/middleware.ts` — add `/profile/:path*` to matcher

## Acceptance Criteria

- [ ] Unauthenticated `GET /profile` is redirected to `/auth/signin` at middleware level
- [ ] `/profile` behavior matches `/portfolio` auth gating

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (security-sentinel agent)
