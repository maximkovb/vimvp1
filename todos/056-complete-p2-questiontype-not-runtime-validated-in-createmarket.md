---
status: complete
priority: p2
issue_id: "056"
tags: [code-review, security, typescript, server-action]
---

# `questionType` not runtime-validated before use in `createMarket`

## Problem Statement

`questionType` is read from FormData and TypeScript-cast to `"views" | "likes"` but never runtime-validated. The raw string value is written directly to the `markets` table (Drizzle's `$type` is TypeScript-only, no runtime enforcement) and used in the floor guard's ternary and the error message. An invalid `questionType` (e.g. `"foo"`) silently falls through the ternary to use `initialLikeCountRaw`, uses the wrong floor, and stores an invalid enum value in the database.

## Findings

- **File:** `src/lib/actions/admin.ts` — lines 247–249, 284–285, 321
- `formData.get("questionType") as "views" | "likes"` — cast, no validation
- Used at line 284: `questionType === "views" ? initialViewCountRaw : initialLikeCountRaw` — invalid value silently selects likes branch
- Written to DB at line 321: `questionType` column is `text("question_type").$type<QuestionType>()` — `$type` is TS-only
- Error message at line 289 would read: `"Milestone must be at least 20% above the current  count"` (empty label)
- `resolutionHours` already has a correct allowlist check (`![24,48,72,168].includes(hours)`) — same pattern needed here
- Identified by: security-sentinel (Low), kieran-typescript-reviewer (Should fix)

## Proposed Solutions

### Option A: Inline allowlist check (Recommended)

Add immediately after the existing required-fields check at line 256:

```ts
if (questionType !== "views" && questionType !== "likes") {
  return { error: "Invalid questionType" };
}
```

**Pros:** Matches the existing `resolutionHours` pattern exactly. 2 lines.
**Effort:** Small

### Option B: Zod schema validation

Use `z.enum(["views", "likes"]).parse(formData.get("questionType"))` with a try/catch.

**Pros:** Consistent with Zod patterns elsewhere in the codebase.
**Cons:** More ceremony for a simple check.
**Effort:** Small

## Acceptance Criteria

- [ ] Submitting with `questionType=foo` returns `{ error: "Invalid questionType" }` before any DB write
- [ ] Valid values "views" and "likes" continue to work normally
- [ ] DB never contains an invalid `questionType` value from a direct POST

## Work Log

- 2026-03-24: Found by security-sentinel + kieran-typescript-reviewer during code review of commit cac047a
