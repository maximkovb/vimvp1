---
status: pending
priority: p2
issue_id: "096"
tags: [code-review, architecture, typescript, tiktok, api, validation]
dependencies: []
---

# POST /api/markets: No Cross-Validation of platform + videoId Format

## Problem Statement

`POST /api/markets` validates `platform` and `videoId` independently but does not enforce that the `videoId` format matches the declared `platform`. An agent can submit `{ platform: "youtube", videoId: "1234567890123456789" }` (a valid TikTok numeric ID with a YouTube platform label), and the market is inserted. The YouTube cron then calls the YouTube API with a numeric ID, gets no results, and the market accumulates null poll rows until it expires unresolved.

This is a silent data integrity failure on the agent-facing API.

## Findings

From `src/app/api/markets/route.ts` line 12:
```ts
videoId: z.string().min(1).max(50),  // no format constraint
platform: z.enum(["youtube", "tiktok"]).default("youtube"),
```

The format constraints are well-known and already exported:
- `TIKTOK_VIDEO_ID_RE = /^\d{15,20}$/` in `src/lib/constants.ts`
- YouTube video IDs: `/^[a-zA-Z0-9_-]{11}$/`

Neither is applied in the API route's Zod schema.

## Proposed Solutions

### Option A: Add `.superRefine()` Cross-Validation
```ts
const CreateMarketSchema = z.object({
  videoId: z.string().min(1).max(50),
  platform: z.enum(["youtube", "tiktok"]).default("youtube"),
  // ...
}).superRefine((data, ctx) => {
  const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
  if (data.platform === "youtube" && !YOUTUBE_VIDEO_ID_RE.test(data.videoId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid YouTube video ID format", path: ["videoId"] });
  }
  if (data.platform === "tiktok" && !TIKTOK_VIDEO_ID_RE.test(data.videoId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid TikTok video ID format", path: ["videoId"] });
  }
});
```

**Pros:** Catches platform/ID mismatches at validation time with a clear error
**Effort:** Small
**Risk:** None

### Option B: Restructure as Zod Discriminated Union
```ts
const CreateMarketSchema = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("youtube"), videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/), ...rest }),
  z.object({ platform: z.literal("tiktok"), videoId: z.string().regex(TIKTOK_VIDEO_ID_RE), ...rest }),
]);
```

**Pros:** Most type-safe; platform and ID are co-validated
**Cons:** Duplicates the common fields unless using `.merge()`; more verbose
**Effort:** Medium

## Recommended Action

Option A — `superRefine` adds the cross-validation with minimal structural change.

## Technical Details

- **Affected file:** `src/app/api/markets/route.ts`
- **Import needed:** `TIKTOK_VIDEO_ID_RE` from `@/lib/constants`
- **YouTube ID pattern:** `/^[a-zA-Z0-9_-]{11}$/` (inline — well-known constant)

## Acceptance Criteria

- [ ] `{ platform: "youtube", videoId: "1234567890123456789" }` → 400 validation error
- [ ] `{ platform: "tiktok", videoId: "dQw4w9WgXcQ" }` → 400 validation error
- [ ] Valid YouTube + YouTube ID → 201 created
- [ ] Valid TikTok + TikTok ID → 201 created

## Work Log

- 2026-03-29: Identified by architecture-strategist and kieran-typescript-reviewer during TikTok integration code review
