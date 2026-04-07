---
status: pending
priority: p2
issue_id: "074"
tags: [code-review, security, api]
dependencies: []
---

# `POST /api/markets` stores arbitrary thumbnail URLs — no domain validation unlike the server action

## Problem Statement

`videoMetadata.thumbnail` in `CreateMarketSchema` is `z.string().default("")` with no URL format or domain validation. The server action `createMarket()` in `admin.ts` applies `YOUTUBE_THUMBNAIL_RE` (`/^https:\/\/i\.ytimg\.com\//`) to reject non-YouTube thumbnail URLs before writing to the database. The API route writes `data.videoMetadata` directly to the JSONB column without this check.

A bearer-token holder can persist an arbitrary URL (including attacker-controlled hostnames) that will later be served to frontend clients in `<img>` tags, or potentially fetched server-side.

## Findings

- `src/app/api/markets/route.ts` line 91: `videoMetadata: data.videoMetadata` — no thumbnail validation
- `src/lib/actions/admin.ts` line 431: `if (!YOUTUBE_THUMBNAIL_RE.test(formData.get("thumbnail") as string))` — correctly validates
- `src/lib/constants.ts` exports `YOUTUBE_THUMBNAIL_RE = /^https:\/\/i\.ytimg\.com\//`
- Frontend renders thumbnails in `<img>` tags in market cards and the market detail page

## Proposed Solution

**Option A (Recommended):** Apply `YOUTUBE_THUMBNAIL_RE` in the Zod schema:
```typescript
videoMetadata: z.object({
  title: z.string(),
  thumbnail: z.string()
    .regex(/^https:\/\/i\.ytimg\.com\//)
    .or(z.literal(""))
    .default(""),
  channelTitle: z.string(),
  channelId: z.string().optional(),
  description: z.string().max(5000).optional(),
}),
```

**Option B:** Apply inline validation in the handler before the insert:
```typescript
import { YOUTUBE_THUMBNAIL_RE } from "@/lib/constants";
if (data.videoMetadata.thumbnail && !YOUTUBE_THUMBNAIL_RE.test(data.videoMetadata.thumbnail)) {
  data.videoMetadata.thumbnail = "";
}
```

Option A is preferred — it's the same constant, and schema-level validation produces the right error message for callers.

- **Effort**: Small
- **Risk**: Low — additive validation; existing callers that supply YouTube thumbnails are unaffected

## Acceptance Criteria

- [ ] `POST /api/markets` rejects (or blanks) thumbnail URLs that don't match `i.ytimg.com`
- [ ] Valid YouTube thumbnail URLs (`https://i.ytimg.com/...`) still accepted
- [ ] Empty thumbnail (`""`) still accepted as the default
- [ ] TypeScript compiles clean

## Work Log

- 2026-03-27: Identified during `/ce:review` — security-sentinel (P3-10, promoted to P2 for content injection risk)
