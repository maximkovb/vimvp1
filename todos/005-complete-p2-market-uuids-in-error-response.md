---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, security, api]
dependencies: []
---

# Scrub Market UUIDs from `errors[]` in Cron HTTP Response

## Problem Statement

The `GET /api/cron/poll-tiktok` response includes an `errors[]` array that contains full market UUIDs in error messages. While the endpoint is auth-gated by `CRON_SECRET`, any log aggregation tool, CI dashboard, or webhook relay that captures cron responses could inadvertently expose internal market IDs.

## Findings

- `src/lib/poll-active-markets.ts` — `errors[]` is built from per-market failures, likely including the market ID in the message
- Market UUIDs are internal identifiers; leaking them in HTTP responses is unnecessary
- The `errors[]` field is returned as the HTTP response body of the cron route, which is often logged by Vercel, monitoring tools, or CI pipelines
- Best practice: log full detail server-side, return only sanitized summaries in HTTP responses

## Proposed Solutions

### Option 1: Log full UUIDs server-side, return count only in HTTP response (Recommended)

**Approach:** In `pollAllActiveMarkets()`, keep detailed error logging via `console.error` (server-side only). In the returned `PollResult`, replace `errors: string[]` with `errorCount: number` or return abbreviated messages without UUIDs.

```typescript
// Instead of:
errors: [`Market ${market.id}: TikWM fetch failed`]

// Return:
errorCount: 1,
// And log to server:
console.error(`[poll] Market ${market.id}: TikWM fetch failed`, err)
```

**Pros:**
- Full detail still available in Vercel logs / log drain
- HTTP response no longer exposes UUIDs
- Follows principle of least privilege in API responses

**Cons:**
- Slightly harder to debug from cron response alone (must check logs)

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Replace UUIDs with short truncated IDs in error messages

**Approach:** Show only first 8 chars of UUID in error strings: `market.id.slice(0, 8)`.

**Pros:**
- Still useful for cross-referencing in logs
- UUIDs not fully exposed

**Cons:**
- Truncated IDs can still leak information
- Doesn't fully eliminate the exposure

**Effort:** 10 minutes

**Risk:** Low

## Recommended Action

Option 1: move UUID details to server-side logs, return `errorCount` in HTTP response. This is a clean separation between observability data (logs) and API responses.

## Technical Details

**Affected files:**
- `src/lib/poll-active-markets.ts` — `PollResult` interface and error accumulation
- `src/app/api/cron/poll-tiktok/route.ts` — passthrough (no change needed if PollResult changes)

## Resources

- **Branch:** feat/creator-baseline-card
- **Review finding:** security-sentinel (Medium)

## Acceptance Criteria

- [ ] `PollResult.errors` either removed or replaced with `errorCount: number`
- [ ] Full error details (including market IDs) logged via `console.error` server-side
- [ ] HTTP response body no longer contains raw UUIDs
- [ ] `scripts/poll-local.sh --force` still returns useful output for debugging

## Work Log

### 2026-04-13 - Code Review Discovery

**By:** Claude Code (ce-review)

**Actions:**
- Identified market UUIDs in errors[] HTTP response
- Confirmed endpoint is auth-gated but exposure in logs is still a concern
- Proposed server-side logging with sanitized HTTP response
