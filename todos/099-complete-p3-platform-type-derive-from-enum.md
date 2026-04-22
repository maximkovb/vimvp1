---
status: pending
priority: p3
issue_id: "099"
tags: [code-review, typescript, tiktok]
dependencies: []
---

# `MarketData.platform` Manually Duplicates the Postgres Enum String Union

## Problem Statement

`src/types/market.ts` manually declares `platform: "youtube" | "tiktok" | "instagram"`. This duplicates the single source of truth in `platformEnum` in `src/db/schema.ts`. If a new platform is added to the schema, `MarketData.platform` will silently drift unless updated manually.

## Findings

From `src/types/market.ts` line 12:
```ts
platform: "youtube" | "tiktok" | "instagram";
```

From `src/db/schema.ts` line 15:
```ts
export const platformEnum = pgEnum("platform", ["youtube", "tiktok", "instagram"]);
```

Drizzle exposes the enum values as a tuple via `platformEnum.enumValues`. The type can be derived as:
```ts
import type { platformEnum } from "@/db/schema";
type Platform = (typeof platformEnum.enumValues)[number];
// → "youtube" | "tiktok" | "instagram"
```

## Proposed Solutions

### Option A: Derive from Enum (Recommended)
```ts
// src/types/market.ts
import type { platformEnum } from "@/db/schema";

export interface MarketData {
  // ...
  platform: (typeof platformEnum.enumValues)[number];
  // ...
}
```

**Pros:** Single source of truth; type error if schema and type drift
**Effort:** Trivial (2-line change)

## Recommended Action

Option A.

## Technical Details

- **Affected file:** `src/types/market.ts`
- **Import:** `import type { platformEnum } from "@/db/schema"`

## Acceptance Criteria

- [ ] `MarketData.platform` is derived from `platformEnum.enumValues`
- [ ] Adding a platform to the DB enum automatically propagates to the TypeScript type
- [ ] TypeScript compiles cleanly

## Work Log

- 2026-03-29: Identified by kieran-typescript-reviewer during TikTok integration code review
