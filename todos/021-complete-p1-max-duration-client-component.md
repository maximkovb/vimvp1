---
status: pending
priority: p1
issue_id: "021"
tags: [code-review, architecture, nextjs]
dependencies: []
---

# maxDuration = 30 Is Silently Ignored on Client Component

## Problem Statement

`export const maxDuration = 30` is declared on line 3 of `src/app/admin/markets/new/page.tsx`, which is a `"use client"` file. Next.js route segment config exports are only read from server-rendered segments at build time — client component modules are bundled for the browser and are never parsed by the build system for segment config. Vercel and all other adapters will silently ignore this export and apply the default 10-second function timeout. The `fetchVideoMetadata()` server action chains 3–4 YouTube API calls plus a Claude API call with a 7.5s timeout; the total p95 wall time is 8–10s. Markets cannot be created on Vercel without a 30-second window.

## Findings

- `src/app/admin/markets/new/page.tsx:1` — `"use client"` directive
- `src/app/admin/markets/new/page.tsx:3` — `export const maxDuration = 30` is unreachable by the build system
- Confirmed in Next.js 16 docs at `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`
- `src/lib/prediction.ts:201-204` — Claude SDK timeout is 7.5s (`timeout: 7_500`) — will hit platform limit before SDK timeout fires

## Proposed Solutions

### Option 1: Add a thin server layout (Recommended)

Create `src/app/admin/markets/new/layout.tsx` as a server component that exports `maxDuration`:

```typescript
// src/app/admin/markets/new/layout.tsx
export const maxDuration = 30;

export default function NewMarketLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

The page itself stays `"use client"` unchanged.

**Pros:** Minimal change; no component refactor needed; layout inherits to all nested routes
**Cons:** Adds a file; layout must remain a server component (no `"use client"`)
**Effort:** Small
**Risk:** Low

---

### Option 2: Rename and split the page

Create `src/app/admin/markets/new/page.tsx` as a thin server wrapper that re-exports a client component:

```typescript
// page.tsx (server)
export const maxDuration = 30;
export { default } from "./CreateMarketClient";
```

```typescript
// CreateMarketClient.tsx
"use client";
// ... all existing component code unchanged ...
```

**Pros:** Explicit; page.tsx is clearly a server file
**Cons:** Larger change; two files instead of one
**Effort:** Small
**Risk:** Low

## Recommended Action

Option 1 — add `layout.tsx`. It's the smallest change and correctly applies `maxDuration` to all admin market creation routes without touching the component.

## Technical Details

**Affected files:**
- `src/app/admin/markets/new/page.tsx` — no change needed; `maxDuration` line can be removed
- `src/app/admin/markets/new/layout.tsx` — new file

## Acceptance Criteria

- [ ] `maxDuration = 30` is exported from a server-side segment (layout or server page wrapper)
- [ ] Vercel build output at `.vercel/output/functions/` shows `maxDuration: 30` for the admin new-market route
- [ ] `"use client"` page no longer exports `maxDuration`
- [ ] Admin can successfully fetch a video and have Claude auto-fill the form on Vercel without a timeout

## Work Log

### 2026-03-23 - Discovery

**By:** TypeScript Reviewer + Architecture Strategist (code review agents)

**Actions:** Found during review of `feat/auto-contract-generation` branch. Confirmed against Next.js 16 route segment config docs.
