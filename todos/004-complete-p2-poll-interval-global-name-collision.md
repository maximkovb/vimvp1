---
status: pending
priority: p2
issue_id: "004"
tags: [code-review, typescript, reliability]
dependencies: []
---

# Verify `__pollInterval` Global Name Doesn't Collide

## Problem Statement

`instrumentation-polling.ts` declares `globalThis.__pollInterval` as a guard to prevent duplicate `setInterval` registrations in Next.js dev mode. The name `__pollInterval` is not namespaced and could collide with any other library or future code that uses the same global key, silently breaking the dedup guard.

## Findings

- `src/lib/instrumentation-polling.ts` — `declare global { var __pollInterval: ReturnType<typeof setInterval> | undefined; }`
- If any other package or future module sets `globalThis.__pollInterval`, the guard `if (globalThis.__pollInterval) return;` would fire prematurely and skip polling
- Convention for private app globals is to use a namespaced key like `__virality_pollInterval` or a Symbol
- This is a dev-only concern (`setInterval` only runs in `NODE_ENV === 'development'`) but could silently suppress all polling in dev

## Proposed Solutions

### Option 1: Namespace the global key (Recommended)

**Approach:** Rename `__pollInterval` to `__virality_pollInterval` in both the declaration and usages.

```typescript
declare global {
  var __virality_pollInterval: ReturnType<typeof setInterval> | undefined;
}
// ...
if (globalThis.__virality_pollInterval) { return; }
globalThis.__virality_pollInterval = setInterval(...);
```

**Pros:**
- Zero collision risk
- 2-line change

**Cons:**
- None

**Effort:** 5 minutes

**Risk:** None

---

### Option 2: Use a module-scoped variable instead of globalThis

**Approach:** Since `instrumentation-polling.ts` is a module, a module-level `let intervalHandle` would persist across hot reloads because Next.js caches the module in dev.

**Pros:**
- No global namespace pollution
- Cleaner TypeScript (no `declare global`)

**Cons:**
- Less obvious that it's the dedup guard
- Module caching behavior in Next.js is subtle; `globalThis` is more predictable

**Effort:** 15 minutes

**Risk:** Low (but behavior may differ on edge cases of module re-evaluation)

## Recommended Action

Option 1: rename to `__virality_pollInterval`. It's a 2-line change with no risk.

## Technical Details

**Affected files:**
- `src/lib/instrumentation-polling.ts` — declaration and two usages of the global name

## Resources

- **Branch:** feat/creator-baseline-card
- **Review finding:** architecture-strategist (P2)

## Acceptance Criteria

- [ ] `__pollInterval` renamed to `__virality_pollInterval` (or similarly namespaced)
- [ ] TypeScript `declare global` block updated
- [ ] Both usages (`if` check and assignment) updated
- [ ] Dev server tested: polling fires on startup, does not double-register on HMR

## Work Log

### 2026-04-13 - Code Review Discovery

**By:** Claude Code (ce-review)

**Actions:**
- Identified unnamespaced globalThis key
- Assessed collision risk as low but non-zero
- Proposed namespaced rename as trivial mitigation
