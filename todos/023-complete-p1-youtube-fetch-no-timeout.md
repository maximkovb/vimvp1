---
status: pending
priority: p1
issue_id: "023"
tags: [code-review, performance, reliability, youtube-api]
dependencies: []
---

# YouTube `fetch()` Calls Have No Timeout — Hung Socket Holds Worker 30s

## Problem Statement

All four YouTube Data API calls in `fetchVideoMetadata()` use bare `fetch()` with `{ cache: "no-store" }` and no `signal: AbortSignal.timeout(...)`. The Next.js page allows up to 30 seconds (`maxDuration = 30`). A hung YouTube socket (regional outage, slow CDN route) will hold the entire server action open until the platform hard-kills it at 30s. During that window the admin sees an indefinite spinner. Under any concurrent admin load, stalled requests exhaust the serverless concurrency pool.

## Findings

- `src/lib/actions/admin.ts:50` — video fetch: no timeout
- `src/lib/actions/admin.ts:80` — channel fetch: no timeout
- `src/lib/actions/admin.ts:84` — search fetch: no timeout
- `src/lib/actions/admin.ts:103` — batch stats fetch: no timeout
- The outer `try/catch` at line 70 does catch `TimeoutError` from `AbortSignal.timeout()` if added — the fallback to `contract = null` already handles it correctly

## Proposed Solutions

### Option 1: Add `AbortSignal.timeout()` to all four calls (Recommended)

```typescript
const YT_TIMEOUT_MS = 8_000;

// line 50 — video fetch (outside try/catch, wrap separately)
const res = await fetch(videoUrl, {
  cache: "no-store",
  signal: AbortSignal.timeout(YT_TIMEOUT_MS),
});

// lines 80, 84 — inside Promise.all
fetch(channelUrl, { cache: "no-store", signal: AbortSignal.timeout(YT_TIMEOUT_MS) }),
fetch(searchUrl,  { cache: "no-store", signal: AbortSignal.timeout(YT_TIMEOUT_MS) }),

// line 103 — batch stats
const statsRes = await fetch(statsUrl, {
  cache: "no-store",
  signal: AbortSignal.timeout(YT_TIMEOUT_MS),
});
```

**Pros:** 4-line change; no behavior change on happy path; hung calls fail fast at 8s; outer try/catch handles TimeoutError automatically
**Cons:** None
**Effort:** Small
**Risk:** Low

---

### Option 2: Wrap the entire analytics block in a `Promise.race` with a timeout

Single timeout for the full analytics chain (excluding the LLM call).

**Pros:** Simpler code; single timeout value
**Cons:** Harder to reason about which call stalled; less granular
**Effort:** Small
**Risk:** Low

## Recommended Action

Option 1. Per-call timeouts give clearer error attribution and integrate naturally with the existing outer try/catch.

## Technical Details

**Affected files:**
- `src/lib/actions/admin.ts:50,80,84,103`

## Acceptance Criteria

- [ ] All four YouTube `fetch()` calls include `signal: AbortSignal.timeout(8_000)` (or equivalent)
- [ ] When a YouTube call is blocked (simulate via network proxy or DNS override), the action returns within ~8s rather than hanging 30s
- [ ] The admin form shows the correct "analytics unavailable" state (not an error) when YouTube times out
- [ ] No regression on happy path — video fetch still completes normally for valid URLs

## Work Log

### 2026-03-23 - Discovery

**By:** Performance Oracle (code review agent)
