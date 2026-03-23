---
status: pending
priority: p1
issue_id: "022"
tags: [code-review, reliability, youtube-api]
dependencies: ["025"]
---

# Unguarded `thumbnails.medium.url` Access Throws Outside try/catch

## Problem Statement

`src/lib/actions/admin.ts:165` accesses `item.snippet.thumbnails.medium.url` without optional chaining. This line is outside the outer `try/catch` block (lines 70–160). YouTube Shorts and some older videos do not always include a `medium` thumbnail in the API response — the API returns what it has even when the `fields` filter requests it. If `item.snippet.thumbnails.medium` is `undefined`, this throws an unhandled error and the entire `fetchVideoMetadata` server action crashes with a 500 response rather than returning a graceful error.

## Findings

- `src/lib/actions/admin.ts:165` — `thumbnail: item.snippet.thumbnails.medium.url` — no optional chaining
- This line is outside the `try/catch` block at lines 70–160 — crash is unhandled
- The root cause is that `res.json()` returns `any` (see todo 025), so TypeScript cannot warn about this

## Proposed Solutions

### Option 1: Add optional chaining with fallback (Recommended)

```typescript
thumbnail: item.snippet.thumbnails?.medium?.url
  ?? item.snippet.thumbnails?.default?.url
  ?? "",
```

**Pros:** Handles Shorts and legacy videos gracefully; consistent with YouTube API reality
**Cons:** Empty string thumbnail will render a broken image in the UI (acceptable; the admin can still see title/channel)
**Effort:** Small
**Risk:** Low

---

### Option 2: Move the return block inside the outer try/catch

Move lines 162–170 inside the outer `try/catch` so analytics failures and thumbnail failures are handled together.

**Pros:** Any future property access on `item` is covered
**Cons:** Changes control flow; if analytics analytics succeed but thumbnail fails, contract is lost
**Effort:** Small
**Risk:** Medium

## Recommended Action

Option 1 — add optional chaining. Surgical fix, no control flow changes.

## Technical Details

**Affected files:**
- `src/lib/actions/admin.ts:165`

## Acceptance Criteria

- [ ] `item.snippet.thumbnails?.medium?.url` uses optional chaining
- [ ] Fallback to `default` thumbnail or empty string
- [ ] Fetching a YouTube Short URL does not 500 the server action
- [ ] Fetching a video with no medium thumbnail returns the video metadata with empty thumbnail string

## Work Log

### 2026-03-23 - Discovery

**By:** TypeScript Reviewer (code review agent)

**Actions:** Found during review of `feat/auto-contract-generation` branch.
