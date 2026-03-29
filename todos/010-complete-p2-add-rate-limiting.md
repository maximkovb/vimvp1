---
status: pending
priority: p2
issue_id: "010"
tags: [code-review, security, performance]
dependencies: []
---

# Add Rate Limiting to Server Actions and Auth Endpoints

## Problem Statement

No server action has any rate limiting, IP throttling, or per-user request frequency cap. The `signIn` credentials endpoint has no lockout after failed password attempts. `claimDailyReward` (combined with the double-claim race) can be brute-forced for coins. `fetchVideoMetadata` drains YouTube API quota with no throttle. Anyone can spam `buyShares`/`sellShares` to put heavy load on the database.

## Findings

- `src/lib/actions/*.ts`: no rate limiting on any exported server action
- `src/lib/auth.ts` Credentials provider: no failed login attempt tracking or lockout
- `src/lib/actions/economy.ts` — claimDailyReward callable many times per second from concurrent clients
- `src/lib/actions/admin.ts:29` — `fetchVideoMetadata` is unauthenticated (separate issue 011) AND unthrottled; each call consumes YouTube API quota
- YouTube Data API v3 daily quota: 10,000 units; unlimited `fetchVideoMetadata` calls exhaust this rapidly
- No Vercel Edge middleware rate limiting rules

## Proposed Solutions

### Option 1: Vercel KV (Upstash Redis) Token Bucket

**Approach:** Use `@upstash/ratelimit` with Vercel KV for per-user/per-IP rate limits on the most sensitive actions.

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { kv } from "@vercel/kv";

const dailyRewardRateLimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(3, "1 m"), // 3 attempts per minute per user
});
```

**Pros:** Works serverlessly; per-user granularity using session ID as key
**Cons:** Requires Vercel KV addon (paid tier); adds dependency

**Effort:** 3-4 hours
**Risk:** Low

---

### Option 2: Database-Backed Counter

**Approach:** Add a `rateLimitAttempts` and `rateLimitResetAt` column to users, check and increment in-transaction.

**Pros:** No external service; works with existing Neon DB
**Cons:** Every rate-limited action hits the DB; harder to enforce at edge

**Effort:** 4-6 hours
**Risk:** Low

---

### Option 3: Failed Login Lockout Only (Minimum Viable)

**Approach:** Track `failedLoginAttempts` and `lockedUntil` on the users table for the credentials provider. Apply to the most critical endpoint first.

**Pros:** Minimal scope; protects credential brute-force immediately
**Cons:** Doesn't protect economy/trade endpoints

**Effort:** 2 hours
**Risk:** Low

## Recommended Action

Option 3 as an immediate fix for credential brute-force, then plan Option 1 for broader coverage.

## Technical Details

**Affected files:**
- `src/lib/auth.ts` — add lockout check in credentials authorize callback
- `src/db/schema.ts` — add `failedLoginAttempts` integer and `lockedUntil` timestamp to users
- `src/lib/actions/economy.ts` — add rate limit check for claimDailyReward
- `src/lib/actions/admin.ts` — restrict fetchVideoMetadata to authenticated admins (see issue 011)

**Migration needed:** Add `failed_login_attempts` and `locked_until` columns to users table.

## Acceptance Criteria

- [ ] Credentials login is locked for N minutes after M failed attempts
- [ ] `claimDailyReward` is throttled to reasonable frequency per user
- [ ] `fetchVideoMetadata` is restricted to authenticated admins (issue 011)
- [ ] Rate limit state is persisted (DB or Redis, not in-memory)
- [ ] Legitimate users are not blocked by false positives

## Work Log

### 2026-03-22 - Discovery

**By:** Security sentinel (code review)
