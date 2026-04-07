---
status: complete
priority: p1
issue_id: "038"
tags: [code-review, agent-native, api]
dependencies: []
---

# `POST /api/markets` Schema Doesn't Accept `channelId` or `description`

## Problem Statement

The `CreateMarketSchema.videoMetadata` validator in the markets API route only declares `title`, `thumbnail`, and `channelTitle`. The two new fields added in this PR (`channelId` and `description`) are not in the schema. An agent POSTing to create a market cannot supply these fields — Zod strips unknown keys by default, meaning API-created markets will never have channel history or video description shown on their detail pages, even though the admin form path does store them.

## Findings

- `src/app/api/markets/route.ts` `CreateMarketSchema.videoMetadata` accepts only `{ title, thumbnail, channelTitle }`
- `src/lib/actions/admin.ts` `createMarket` **does** accept `channelId` and `videoDescription` via FormData and writes them to JSONB
- `src/app/markets/[id]/page.tsx` line 136 gates `ChannelHistorySection` on `videoMetadata?.channelId`
- Result: markets created via API silently produce second-class markets with no channel intelligence UI
- Agent-native reviewer rated this as critical, blocking agent parity

## Proposed Solutions

### Solution A: Extend the schema to match the DB type (Recommended)
```ts
videoMetadata: z.object({
  title: z.string(),
  thumbnail: z.string().default(""),
  channelTitle: z.string(),
  channelId: z.string().optional(),
  description: z.string().max(5000).optional(),
}),
```
- **Pros**: Full parity between admin form and API; agents can create feature-complete markets
- **Cons**: None
- **Effort**: Small
- **Risk**: Low — additive change, existing API callers are unaffected

### Solution B: Document the gap and leave as-is
- **Pros**: No code change
- **Cons**: Agent-created markets permanently lack channel intelligence; undocumented behavioral divergence
- **Effort**: None
- **Risk**: Medium — silent behavioral difference compounds over time

## Recommended Action

Solution A. One-line schema extension. While here, add `.max(5000)` on `description` to close the length-cap gap identified by security-sentinel.

## Technical Details

- **Affected files**: `src/app/api/markets/route.ts`
- **Schema location**: `CreateMarketSchema`, approximately line 24

## Acceptance Criteria

- [ ] `CreateMarketSchema.videoMetadata` includes `channelId: z.string().optional()` and `description: z.string().max(5000).optional()`
- [ ] `POST /api/markets` with `videoMetadata.channelId` persists the field to the DB row
- [ ] Loading the market detail page for an API-created market with `channelId` shows the Channel History section
- [ ] `POST /api/markets` without `channelId` continues to succeed (field is optional)

## Work Log

- 2026-03-23: Identified by agent-native-reviewer during code review of feat/video-intelligence-panel
