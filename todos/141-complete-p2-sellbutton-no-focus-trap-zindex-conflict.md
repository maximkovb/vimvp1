---
name: SellButton modal has no focus trap and z-index conflicts with Vaul drawer
description: SellButton's manual fixed overlay lacks aria-modal and focus trap — keyboard users can tab into drawer content behind the modal
type: bug
status: pending
priority: p2
issue_id: "141"
tags: [code-review, accessibility, ux, frontend]
dependencies: []
---

## Problem Statement

`src/components/SellButton.tsx:56-96` renders a `fixed inset-0 z-50` overlay when the sell modal is open. The Vaul drawer also uses `z-50`. On mobile, dismissing the backdrop only closes the modal — the drawer stays open underneath. More critically, there is no focus trap, so keyboard users can Tab into the drawer's content behind the modal. This is an accessibility violation (WCAG 2.1 focus management requirement).

## Findings

- **`src/components/SellButton.tsx:56-96`**: `div fixed inset-0 z-50` with no `aria-modal="true"`, no focus trap
- Drawer uses same z-index layer — modal and drawer compete

## Proposed Solutions

### Option A: Use a Radix Dialog or proper modal primitive
Replace the manual overlay with Radix `<Dialog>` which provides focus trap, `aria-modal`, and proper keyboard handling automatically.
- **Effort:** Small (replace ~40 lines of manual overlay with Dialog primitive)
- **Risk:** Low — visual behavior should be identical

### Option B: Add focus trap manually + elevate z-index
`z-[100]` for the modal + `aria-modal="true"` + `useEffect` to lock focus within the modal.
- **Effort:** Medium (manual implementation)

## Acceptance Criteria
- [ ] Keyboard Tab cannot reach drawer content when sell modal is open
- [ ] `aria-modal="true"` on the modal container
- [ ] Backdrop click closes modal without leaving drawer in inconsistent state
- [ ] Screen readers correctly announce the modal

## Work Log
- 2026-04-06: Identified by architecture-strategist during ce:review
