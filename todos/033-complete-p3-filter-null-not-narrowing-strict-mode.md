---
status: pending
priority: p3
issue_id: "033"
tags: [code-review, typescript, strict-mode]
dependencies: []
---

# `.filter(line => line !== null)` Does Not Narrow Type in TypeScript Strict Mode

## Problem Statement

`buildUserPrompt()` in `prediction.ts:176` uses `.filter((line) => line !== null).join("\n")`. The array type is `(string | null)[]`. TypeScript strict mode does not narrow through a callback predicate of the form `x !== null` — it requires a type predicate. The `.join()` call works at runtime (null coerces to `"null"`) but means the type is not correctly narrowed to `string[]`, and a future reader might not realize `null.toString()` in join is masking a type error.

## Findings

- `prediction.ts:175-177` — `.filter((line) => line !== null).join("\n")`
- Array type: `(string | null)[]` — filter does not narrow to `string[]` without predicate

## Proposed Solutions

### Option 1: Use a type predicate (Recommended)

```typescript
.filter((line): line is string => line !== null)
.join("\n")
```

**Pros:** Correctly narrows to `string[]`; explicit intent
**Note:** Do NOT use `.filter(Boolean)` — the empty string `""` on line 167 is intentional spacing and must not be filtered out.
**Effort:** Tiny  **Risk:** Low

## Acceptance Criteria

- [ ] `.filter((line): line is string => line !== null)` used in `buildUserPrompt()`
- [ ] The intentional empty-string line `""` (line 167) still appears in the prompt output
- [ ] TypeScript compiler reports no type error on `.join("\n")`

## Work Log

### 2026-03-23 - Discovery

**By:** TypeScript Reviewer (code review agent)
