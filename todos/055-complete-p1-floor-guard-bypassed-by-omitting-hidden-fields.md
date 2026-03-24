---
status: complete
priority: p1
issue_id: "055"
tags: [code-review, security, market-creation, server-action]
---

# Floor guard bypassed by omitting `initialViewCount` / `initialLikeCount` hidden fields

## Problem Statement

The server-side 20% floor guard is wrapped in `if (!isNaN(initialViewCountRaw) && !isNaN(initialLikeCountRaw))`. If either field is absent or empty, `parseInt("")` returns `NaN`, the condition is false, and the entire floor check is silently skipped. A market with a milestone below the current analytics will be persisted to the database with no error. This is exploitable by any admin POST that omits the hidden fields, and is a risk for agent callers who construct FormData without knowing about these fields.

## Findings

- **File:** `src/lib/actions/admin.ts` — lines 281–292
- `parseInt(formData.get("initialViewCount") as string)` → `parseInt("")` → `NaN`
- `if (!isNaN(...) && !isNaN(...))` — whole guard skips silently
- Floor set to `ceil(0 × 1.2) = 0` if fields are set to `"0"` or empty
- A direct POST omitting both fields creates any milestone value, including 1 view, on a 10M-view video
- Confirmed by: security-sentinel (Medium, admin-gated), agent-native-reviewer (Critical for agents), learnings-researcher (institutional pattern: hidden fields were designed for display metadata, not validation)

## Proposed Solutions

### Option A: Make fields unconditionally required (Recommended)

```ts
const initialViewCountRaw = parseInt((formData.get("initialViewCount") ?? "") as string);
const initialLikeCountRaw = parseInt((formData.get("initialLikeCount") ?? "") as string);
if (isNaN(initialViewCountRaw) || isNaN(initialLikeCountRaw)) {
  return { error: "initialViewCount and initialLikeCount are required" };
}
// floor check runs unconditionally:
const initialCount = questionType === "views" ? initialViewCountRaw : initialLikeCountRaw;
const requiredFloor = Math.ceil(initialCount * 1.2);
if (Number(milestoneThresholdRaw) < requiredFloor) {
  return { error: `Milestone must be at least 20% above the current ${questionType} count (minimum: ${requiredFloor.toLocaleString()})` };
}
```

**Pros:** Simple, closes the bypass completely. 1 existing call site (the browser form) already supplies the fields.
**Cons:** Any direct API call (agent, script) that doesn't supply these fields now gets an error instead of silently passing.
**Effort:** Small

### Option B: Re-fetch from YouTube API when fields absent

Call a lightweight YouTube stats-only fetch (`part=statistics&fields=items/statistics`) inside `createMarket` when the fields are missing, using the already-validated `videoId`.

**Pros:** Authoritative server-side source; also fixes staleness (fields reflect fetch time, not submission time).
**Cons:** Additional YouTube quota cost and latency on every submission. The LLM contract call already happened at fetch time — this adds only the cheap stats endpoint.
**Effort:** Medium

### Option C: HMAC-signed hidden fields

Sign `initialViewCount` and `initialLikeCount` server-side at fetch time; verify signature in `createMarket`.

**Pros:** Prevents tampering while keeping the round-trip pattern.
**Cons:** Significant complexity; overkill for admin-only UI.
**Effort:** Large

## Acceptance Criteria

- [ ] Submitting `createMarket` without `initialViewCount` field returns an error (not success)
- [ ] Submitting with `initialViewCount=0` and a milestone of 100 fails the floor check
- [ ] Submitting with correct fields and milestone above floor succeeds
- [ ] Agent calls (programmatic FormData) are subject to the same floor enforcement as browser submissions

## Work Log

- 2026-03-24: Found by security-sentinel + agent-native-reviewer + learnings-researcher during code review of commit cac047a

## Resources

- PR commit: `cac047a`
- File: `src/lib/actions/admin.ts:281–292`
- Related: todo #054 (anchor divergence)
- Learnings: `docs/solutions/integration-issues/anthropic-claude-api-nextjs-server-action.md` — hidden fields were designed for display metadata transport, not server-side validation
