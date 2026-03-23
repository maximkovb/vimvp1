---
status: pending
priority: p3
issue_id: "034"
tags: [code-review, llm, configuration, maintainability]
dependencies: []
---

# Hardcoded Model Fallback `"claude-sonnet-4-6"` Will Go Stale

## Problem Statement

`const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"` in `prediction.ts:37` uses a hardcoded model name as the fallback. When Anthropic releases a new Claude version and the project upgrades, the env var will be set but the fallback string will become stale. More importantly, if the env var is accidentally unset (e.g., Vercel deployment misconfiguration), the code silently falls back to the hardcoded model rather than surfacing the misconfiguration. This can result in unexpected billing or behavior differences.

## Findings

- `prediction.ts:37` — `process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"`

## Proposed Solutions

### Option 1: Require the env var; throw if missing alongside the API key check (Recommended)

```typescript
function getModel(): string {
  return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
}
```

Add a log warning if falling back:
```typescript
const MODEL = process.env.ANTHROPIC_MODEL;
if (!MODEL) {
  console.warn("[llm:config] ANTHROPIC_MODEL not set, defaulting to claude-sonnet-4-6");
}
const RESOLVED_MODEL = MODEL ?? "claude-sonnet-4-6";
```

**Pros:** Surfaces env var gaps early; no silent stale behavior
**Effort:** Tiny  **Risk:** Low

---

### Option 2: Define the default model in a shared config constant

```typescript
// src/lib/config.ts
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6" as const;
```

**Pros:** Single place to update when upgrading
**Effort:** Small  **Risk:** Low

## Acceptance Criteria

- [ ] Missing `ANTHROPIC_MODEL` env var produces a console warning (not silent)
- [ ] Default model value is defined in one place (not inline in `prediction.ts`)

## Work Log

### 2026-03-23 - Discovery

**By:** TypeScript Reviewer (code review agent)
