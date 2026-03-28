---
status: pending
priority: p3
issue_id: "083"
tags: [code-review, agent-native, documentation]
dependencies: ["072"]
---

# AGENTS.md: draft publish path is misleading, and `GET /api/markets/[id]` is undocumented

## Problem Statement

Two AGENTS.md issues identified by the agent-native reviewer:

1. **Draft publish path implies a complete workflow that doesn't exist.** The current text says agents "can use [draft creation] to stage markets for review" but there is no bearer-token route to publish a draft. An agent following this workflow creates a draft and has no next step. (This is partially resolved if todo #072 adds the publish route, but the docs need updating regardless.)

2. **`GET /api/markets/[id]` is not documented.** This is the primary way an agent verifies a market was created correctly, monitors status changes, or inspects price history. It is missing from AGENTS.md entirely.

## Proposed Solution

Update `AGENTS.md`:

```markdown
## Market Inspection

- `GET /api/markets/[id]` — returns market state: status, priceYes/No, resolvesAt, outcome
  No auth required. Use this to verify creation or monitor status changes.

- `GET /api/markets` — returns all active/halted/resolving markets + last 6 resolved.
  No auth required.
```

Update the Draft vs. publish section:

```markdown
### Draft vs. publish

- `publishImmediately: true` — publishes immediately (UI default)
- `publishImmediately: false` — creates a draft (API default). The `marketId` is returned
  in the 201 response; use `GET /api/markets/[id]` to verify the draft was created.
  **Note:** A separate `PATCH /api/admin/markets/[id]/publish` route is needed to promote
  a draft to active via the API (see todo #072). Until that route exists, use
  `publishImmediately: true` if the agent should go live immediately.
```

- **Effort**: Small
- **Risk**: Zero — documentation only

## Acceptance Criteria

- [ ] `GET /api/markets/[id]` documented in AGENTS.md with its response shape
- [ ] `GET /api/markets` documented with its scope (active + recent resolved only)
- [ ] Draft publish path notes that a publish route is not yet available (or links to the new route once #072 is done)
- [ ] No references to a complete draft-then-publish agent workflow without the caveat

## Work Log

- 2026-03-27: Identified during `/ce:review` — agent-native-reviewer (P2-6, P3-9)
