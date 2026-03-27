---
status: complete
priority: p2
issue_id: "064"
tags: [code-review, quality, server-action, agent-native]
dependencies: []
---

# `publishImmediately` hardcoded in UI creates dead server branch and UI/API asymmetry

## Problem Statement

The `publishImmediately` checkbox was removed from the admin market creation form. The page now always calls `formData.set("publishImmediately", "true")`. However, `createMarket()` in `src/lib/actions/admin.ts` still reads this field and branches on it:

```typescript
status: publishImmediately ? "active" : "draft"
```

The `"draft"` branch is unreachable from the UI, but is still reachable by anyone crafting a direct form submission or calling the server action from a script. This creates three problems:

1. **Dead code**: the `"draft"` status path in `createMarket()` will never be exercised through the UI.
2. **Behavioral asymmetry**: `POST /api/markets` defaults `publishImmediately` to `false`, so agents create drafts while the UI always publishes — the two paths have opposite defaults.
3. **Invisible decision**: removing the checkbox without removing the server logic makes it ambiguous whether draft creation is intentionally unsupported or just temporarily hidden.

## Proposed Solutions

### Option A — Remove draft path from `createMarket()` (if drafts are permanently gone)

Remove the `publishImmediately` field read and hardcode `status: "active"` in the server action. Update `POST /api/markets` to also always set `status: "active"`. Delete the `publishMarket()` action if it has no other callers.

- **Pros**: Eliminates dead code; both paths have identical behaviour.
- **Cons**: Irreversible without a code change if drafts are needed again.
- **Effort**: Small

### Option B — Restore `publishImmediately` toggle in the UI (if drafts should remain supported)

Re-add the checkbox as an optional advanced control (e.g., hidden behind an "Advanced" disclosure or a non-default state). Keep the server logic as-is.

- **Pros**: Preserves the draft capability; fixes the UI/API asymmetry.
- **Cons**: More UI surface to maintain.
- **Effort**: Small

### Option C — Document the asymmetry explicitly

Add a comment in `createMarket()` noting that the UI always sends `"true"`, and update AGENTS.md to document that agents can create drafts via `POST /api/markets` with `publishImmediately: false` while the UI cannot.

- **Pros**: Zero risk; preserves optionality.
- **Cons**: Dead server code remains; doesn't fix the asymmetry.
- **Effort**: Trivial

## Recommended Action

Option A if drafts are intentionally removed, Option B if draft creation is a deliberate agent capability worth preserving as a UI feature too. Decide first, then implement. Option C is acceptable as a short-term bridge.

## Acceptance Criteria

- [ ] The behaviour of `createMarket()` for `publishImmediately = false` is either (a) removed with the dead branch deleted, or (b) accessible from the UI via a checkbox
- [ ] `POST /api/markets` default for `publishImmediately` is consistent with whatever `createMarket()` does
- [ ] AGENTS.md documents whether draft creation is supported and how

## Work Log

- 2026-03-27: Identified during `/ce:review` — architecture-strategist, security-sentinel (F-4), agent-native-reviewer
