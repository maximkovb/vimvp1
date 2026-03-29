---
status: complete
priority: p2
issue_id: "041"
tags: [code-review, security, maintainability]
dependencies: []
---

# `YOUTUBE_THUMBNAIL_RE` Duplicated — Security Constant Has Multiple Definitions

## Problem Statement

`YOUTUBE_THUMBNAIL_RE` is a security-relevant regex that controls which YouTube CDN URLs are allowed into the database and rendered to users. It is currently defined independently in at least two locations: `src/lib/actions/admin.ts` and `src/lib/youtube.ts`. If someone tightens the pattern in one file (e.g., to handle a new YouTube CDN subdomain), the other silently remains behind. This is the classic "security check in two places" failure mode.

## Findings

- `src/lib/actions/admin.ts` line 28: `const YOUTUBE_THUMBNAIL_RE = /^https:\/\/i\.ytimg\.com\//` (module-private)
- `src/lib/youtube.ts` line 3 (approximately): same regex, module-private
- Architecture strategist and TypeScript reviewer both flagged this as the highest-priority maintainability + security issue in the PR
- The plan referenced `@/lib/constants` as the intended source, but `src/lib/constants.ts` was never created

## Proposed Solutions

### Solution A: Create `src/lib/constants.ts` and import from both files (Recommended)
```ts
// src/lib/constants.ts
export const YOUTUBE_THUMBNAIL_RE = /^https:\/\/i\.ytimg\.com\//;
export const YOUTUBE_CHANNEL_ID_RE = /^UC[a-zA-Z0-9_-]{22}$/; // also add for todo 039
```
Remove the local definitions from `admin.ts` and `youtube.ts`, add the import.
- **Pros**: Single source of truth; updating the regex updates all validation sites atomically
- **Cons**: New file (minimal)
- **Effort**: Small
- **Risk**: None — purely a refactor, same regex value

### Solution B: Leave as-is, add a comment linking to the other copy
- **Pros**: No structural change
- **Cons**: Comments rot; future maintainer still changes only one
- **Effort**: Trivial
- **Risk**: Medium — doesn't solve the problem

## Recommended Action

Solution A. Create `src/lib/constants.ts`, export both `YOUTUBE_THUMBNAIL_RE` and `YOUTUBE_CHANNEL_ID_RE` (for todo 039), and update both import sites. This can be bundled with todo 039 into a single PR.

## Technical Details

- **Affected files**: `src/lib/constants.ts` (new), `src/lib/actions/admin.ts`, `src/lib/youtube.ts`

## Acceptance Criteria

- [ ] `src/lib/constants.ts` exports `YOUTUBE_THUMBNAIL_RE`
- [ ] `src/lib/actions/admin.ts` imports `YOUTUBE_THUMBNAIL_RE` from `@/lib/constants`
- [ ] `src/lib/youtube.ts` imports `YOUTUBE_THUMBNAIL_RE` from `@/lib/constants`
- [ ] No other copies of the regex exist in the codebase (`grep -r "i\.ytimg\.com"` returns only `constants.ts` and import sites)
- [ ] All existing thumbnail validation behavior is unchanged

## Work Log

- 2026-03-23: Identified by architecture-strategist and kieran-typescript-reviewer during code review of feat/video-intelligence-panel
