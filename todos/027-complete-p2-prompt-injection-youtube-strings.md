---
status: pending
priority: p2
issue_id: "027"
tags: [code-review, security, llm, prompt-injection]
dependencies: []
---

# Prompt Injection via YouTube Title/Channel Name — Structural Characters Not Stripped

## Problem Statement

`buildUserPrompt()` in `src/lib/prediction.ts` embeds `videoTitle` (sliced to 120 chars) and `channelName` (sliced to 60 chars) directly into the LLM prompt using template literals with surrounding double-quotes. The 120/60 char truncation reduces the surface but does not strip structural characters. A video title containing `"` or `\n` can close the surrounding quote and inject arbitrary text into the prompt. While the `tool_choice: "tool"` forced-use pattern limits response format, the free-form `reasoning` field (validated only as `string.max(600)`) remains injectable, and market parameter manipulation by a coordinated attacker controlling a real YouTube channel is a real financial risk.

## Findings

- `src/lib/prediction.ts:143-144` — title/channel sliced but not sanitized for structural chars
- `src/lib/prediction.ts:162-163` — embedded as `Video: "${title}" by ${channel}` — closing `"` is injectable
- `src/lib/prediction.ts:138` — `reasoning` validated as `z.string().min(1).max(600)` — no content filtering
- Forced tool use (`tool_choice`) limits response shape but does not prevent injection into `reasoning`

## Proposed Solutions

### Option 1: Strip structural characters before prompt embedding (Recommended)

```typescript
function sanitizeForPrompt(s: string, maxLen: number): string {
  return s
    .slice(0, maxLen)
    .replace(/[\r\n"\\]/g, " ")   // strip prompt-structural characters
    .replace(/\s{2,}/g, " ")      // normalize whitespace
    .trim();
}

// In buildUserPrompt():
const title = sanitizeForPrompt(ctx.videoTitle, 120);
const channel = sanitizeForPrompt(ctx.channelName, 60);
```

**Pros:** Simple; eliminates structural injection vectors; no behavior change on normal inputs
**Cons:** Rare video titles with quotes become slightly different in the prompt (cosmetic)
**Effort:** Small
**Risk:** Low

---

### Option 2: Use labeled key-value format instead of embedded quotes

Change from `Video: "${title}" by ${channel}` to `Title: ${title}\nChannel: ${channel}` with no surrounding quotes.

**Pros:** Eliminates the quote-closing attack vector entirely
**Cons:** Slightly different prompt format — regression-test the LLM output quality
**Effort:** Small
**Risk:** Low

## Recommended Action

Option 1 + remove the surrounding double-quotes in the prompt template (combines both options).

## Technical Details

**Affected files:**
- `src/lib/prediction.ts:141-178` — `buildUserPrompt()`

## Acceptance Criteria

- [ ] `buildUserPrompt()` strips `"`, `\r`, `\n`, `\\` from title and channel before embedding
- [ ] A title containing `"IGNORE PREVIOUS INSTRUCTIONS` does not alter the LLM's tool output (test manually)
- [ ] Normal video titles are unchanged in behavior (no prompt quality regression)

## Work Log

### 2026-03-23 - Discovery

**By:** Security Sentinel (code review agent)
