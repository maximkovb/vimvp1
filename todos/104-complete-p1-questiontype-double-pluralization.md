---
status: pending
priority: p1
issue_id: "104"
tags: [code-review, bug, feed]
dependencies: []
---

# Fix `{questionType}s` double-pluralization in FeedCard

## Problem Statement

`QuestionType` values are already plural (`"views"` and `"likes"`). The milestone label in `FeedCard.tsx` appends another `s`, rendering "viewss" and "likess" to users.

## Findings

- `src/components/FeedCard.tsx:164`: `{Number(milestoneThreshold).toLocaleString()} {questionType}s`
- `QuestionType = "views" | "likes"` — both values already plural (`src/db/schema.ts`)
- Renders as "Target: 1,000,000 viewss" or "Target: 500,000 likess" — visible to every user on every feed card

## Proposed Solutions

### Option 1: Remove the trailing `s`

**Approach:** Change template literal to `{questionType}` without appending `s`.

```tsx
<p className="text-xs text-white/40 mb-3">
  Target: {Number(milestoneThreshold).toLocaleString()} {questionType}
</p>
```

**Pros:** One-character fix, correct output
**Cons:** None

**Effort:** 5 minutes
**Risk:** None

## Recommended Action

Remove the `s` from the template literal at `FeedCard.tsx:164`.

## Technical Details

**Affected files:**
- `src/components/FeedCard.tsx:164`

## Acceptance Criteria

- [ ] Feed cards display "1,000,000 views" and "500,000 likes" (not "viewss"/"likess")

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (kieran-typescript-reviewer agent)
