---
status: pending
priority: p1
issue_id: "094"
tags: [code-review, tiktok, architecture, instagram, schema]
dependencies: []
---

# `"instagram"` in Zod Schema Creates Unresolvable Markets

## Problem Statement

`POST /api/markets` accepts `platform: "instagram"` via its Zod schema (`z.enum(["youtube", "tiktok", "instagram"])`). There is no Instagram implementation — no cron, no fetch function, no oracle branch. If an agent submits `platform: "instagram"`, the market is inserted successfully and will silently become unresolvable: the oracle's `else` branch falls through to query `youtubePolls` for it, finds nothing, and the market expires without resolution.

This is a footgun baked into the external API contract.

## Findings

From `src/app/api/markets/route.ts` line 13:
```ts
platform: z.enum(["youtube", "tiktok", "instagram"]).default("youtube"),
```

From `src/lib/oracle.ts` (resolveMarket):
```ts
if (market.platform === "tiktok") {
  // query tiktokPolls
} else {
  // query youtubePolls — Instagram markets fall here, find 0 polls, expire
}
```

No Instagram cron. No Instagram stat fetch. The Postgres `platformEnum` having the value is fine (reserves the DB value); the Zod schema accepting it is not — it means the API contract says Instagram markets can be created today.

## Proposed Solutions

### Option A: Remove `"instagram"` from Zod Schema (Recommended)
```ts
platform: z.enum(["youtube", "tiktok"]).default("youtube"),
```

Keep `"instagram"` in the Postgres `platformEnum` to reserve the DB value. Remove it from the Zod validator that enforces the API contract. Add it back to both when Instagram support is fully implemented.

**Pros:** Prevents the footgun; zero behavior change for YouTube and TikTok
**Effort:** Trivial (1-character change)
**Risk:** None — only restricts invalid input

### Option B: Add Oracle Guard
Add an explicit check in `resolveMarket` that throws for unhandled platforms, making the failure loud rather than silent.

**Pros:** Makes the failure obvious rather than silent expiration
**Cons:** Doesn't prevent the broken market from being created
**Effort:** Small

## Recommended Action

Option A — remove from Zod, keep in Postgres enum. One-line fix.

## Technical Details

- **Affected file:** `src/app/api/markets/route.ts` line 13
- **Change:** `z.enum(["youtube", "tiktok", "instagram"])` → `z.enum(["youtube", "tiktok"])`

## Acceptance Criteria

- [ ] `POST /api/markets` with `platform: "instagram"` returns 400 validation error
- [ ] YouTube and TikTok market creation unaffected
- [ ] `platformEnum` in schema.ts still includes `"instagram"` (reserved for future use)

## Work Log

- 2026-03-29: Identified by architecture-strategist during TikTok integration code review
