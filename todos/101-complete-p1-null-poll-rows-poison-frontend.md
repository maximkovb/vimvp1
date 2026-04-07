---
status: pending
priority: p1
issue_id: "101"
tags: [tiktok, polling, cron, p1, code-review]
dependencies: []
---

# Guard DB Insert in poll-tiktok Route Against Null Stats

Prevent null-stats rows from being written to the DB, which causes the frontend to render nothing.

## Problem Statement

`poll-tiktok/route.ts` lines 73-77 unconditionally inserts a DB row even when `stats === null` (i.e., the TikWM API call failed). The frontend's `pollHistory[length-1]` then points to this null row, so `LiveEngagementStats` receives null and renders nothing. This is the root cause of the "polling doesn't update" bug.

## Findings

- `src/app/api/cron/poll-tiktok/route.ts:73-77` — DB insert runs regardless of whether `stats` is null
- When TikWM fails and returns null, a poisoned row is written to the DB
- `pollHistory[length-1]` (the most recent row) is the null row
- `LiveEngagementStats` receives null data and renders an empty UI
- The symptom ("polling doesn't update") is caused entirely by this missing guard, not by any polling frequency or SWR configuration issue

## Proposed Solutions

### Option 1: Guard insert with null check (recommended)

**Approach:** Wrap the insert block at lines 73-77 in a `if (stats !== null)` check. If stats is null, log a warning and return early (or continue to the next poll iteration) without writing to the DB.

**Pros:**
- Minimal, surgical change — one conditional wrapping existing code
- Preserves all existing logic for the success path
- Stops poisoned rows immediately

**Cons:**
- Silent failures if no alerting is added for the null case

**Effort:** 15-30 minutes

**Risk:** Low

---

### Option 2: Guard insert and emit a structured error metric

**Approach:** Same null check, but also increment a failure counter or write a separate `poll_errors` table row so failures are observable without poisoning `pollHistory`.

**Pros:**
- Fixes the bug and adds observability
- Easier to diagnose TikWM downtime in future

**Cons:**
- Slightly more scope; requires a schema change or separate logging path

**Effort:** 1-2 hours

**Risk:** Low

---

## Recommended Action

**To be filled during triage.** Apply Option 1 immediately to unblock polling. Follow up with Option 2 in a separate task for observability.

## Technical Details

**Affected files:**
- `src/app/api/cron/poll-tiktok/route.ts:73-77` — insert block that needs the null guard

**Related components:**
- `LiveEngagementStats` — consumes `pollHistory[length-1]`; will render correctly once null rows are absent
- TikWM API client — source of the null stats value on failure

**Database changes (if any):**
- Migration needed? No
- No new columns or tables required for Option 1

## Resources

- **Related todo:** 102 (SWR duplicate fetcher refs), 103 (tautological ternary in LastUpdated)
- **Code review finding:** poll-tiktok/route.ts:73-77

## Acceptance Criteria

- [ ] `poll-tiktok/route.ts` does not insert a row when `stats === null`
- [ ] Existing rows in the DB from null inserts are cleaned up (or frontend handles historic nulls gracefully)
- [ ] Live polling UI (`LiveEngagementStats`) renders real data after a successful TikWM response
- [ ] No regression on the happy path (successful TikWM response still writes a row)
- [ ] Code reviewed and approved

## Work Log

### 2026-04-02 - Initial Discovery

**By:** Claude Code (code review)

**Actions:**
- Identified unconditional DB insert at route.ts:73-77
- Traced data flow from cron → DB → `pollHistory` → `LiveEngagementStats`
- Confirmed this is the root cause of "polling doesn't update"

**Learnings:**
- The bug is entirely server-side; SWR and frontend rendering are working correctly once valid data is present

---

## Notes

- P1 because this is the confirmed root cause of the visible "polling doesn't update" regression
- Fix is trivial; should be addressed before any frontend polish work
