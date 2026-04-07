---
name: TradePanel outcome toggle preview not debounced — stale preview race condition
description: handleOutcomeChange calls previewTrade directly without debouncing; rapid YES/NO toggle causes stale preview to display for wrong outcome
type: bug
status: pending
priority: p3
issue_id: "147"
tags: [code-review, frontend, race-condition, ux]
dependencies: []
---

## Problem Statement

`src/components/TradePanel.tsx:47-61` calls `previewTrade()` in `handleOutcomeChange` without debouncing. If a user rapidly toggles YES/NO while typing an amount, multiple preview requests are in-flight simultaneously. The last one to resolve wins — potentially showing a YES preview while NO is selected. The debounce timer ref `previewTimerRef` is only used in `handleAmountChange`, not in `handleOutcomeChange`.

## Findings

- **`src/components/TradePanel.tsx:47-61`**: no debounce or cancellation in `handleOutcomeChange`
- `previewTimerRef` exists but is not shared with the outcome change handler

## Proposed Solutions

### Option A: Share debounce logic between both handlers
Extract a debounced `triggerPreview(outcome, amount)` function used by both `handleAmountChange` and `handleOutcomeChange`. Use an AbortController or version token to cancel stale requests.
- **Effort:** Small
- **Risk:** Low

## Acceptance Criteria
- [ ] Rapidly toggling YES/NO never shows a preview for the wrong outcome
- [ ] Debounce logic is shared between amount and outcome change handlers

## Work Log
- 2026-04-06: Identified by architecture-strategist during ce:review
