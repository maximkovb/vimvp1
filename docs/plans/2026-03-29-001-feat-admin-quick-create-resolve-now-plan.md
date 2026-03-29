---
title: "feat: Admin Quick Test Market Creation + Resolve Now Button"
type: feat
status: completed
date: 2026-03-29
---

# feat: Admin Quick Test Market Creation + Resolve Now Button

## Overview

Add a fast "quick create" path for spinning up test markets without going through the
two-phase AI suggestion pipeline, plus a "Resolve Now" button that lets admins trigger the
oracle resolution flow (`resolveMarket` from `src/lib/oracle.ts`) on any live market.

The existing complex form at `src/app/admin/markets/new/` is **unchanged**.

## Problem Statement / Motivation

- The full market creation flow takes 5–15s (two API phases + LLM) and requires many form
  fields. For testing oracle resolution, a simple "create with defaults and resolve" loop is
  too slow.
- The oracle's `resolveMarket()` function introduced in the previous commit has no admin UI
  trigger. Resolution currently requires either the cron job or manual YES/NO from the
  `manualResolve` action (which bypasses the oracle entirely).

## Proposed Solution

1. **New `src/app/admin/markets/quick/page.tsx`** — a minimal form: paste URL →
   fetch title/thumbnail/channel → set milestone → create market with test defaults
   (b=0.01, resolvesAt=now+48h, status="active"). Uses the existing `fetchVideoStats`
   server action for the fetch step.

2. **New `createTestMarket` server action** in `src/lib/actions/admin.ts` — accepts
   videoId, milestoneThreshold, questionType. Fetches basic video stats, inserts market
   with hardcoded test defaults. Bypasses the b≥1 validation (test-only path, admin-gated).

3. **New `resolveNow` server action** in `src/lib/actions/admin.ts` — transitions the
   market to `"resolving"` then calls `resolveMarket(marketId)` from oracle.ts. Works for
   `active`, `halted`, `resolving`, and `failed` statuses.

4. **Updated `src/components/AdminMarketActions.tsx`** — add "Resolve Now" button
   rendered for `active` and `halted` markets, calling `resolveNow(marketId)`.

5. **Updated `src/app/admin/markets/page.tsx`** — add a small "Quick Create →" link
   pointing to `/admin/markets/quick`.

## Technical Considerations

- **b=0.01 is below the current validation floor (b≥1)** in `createMarket`. The
  `createTestMarket` action must be a separate code path that hardcodes b=0.01 without
  going through that guard. The `decimal(10,2)` DB column accepts 0.01.
- **`resolveMarket` requires status="resolving"**: The `resolveNow` action must
  `UPDATE markets SET status='resolving' WHERE id=? AND status NOT IN ('resolved', 'cancelled')`
  before calling `resolveMarket(marketId)`. The oracle's idempotency guard
  (`.where(status='resolving')`) then fires correctly.
- **No poll data = oracle throws**: If no `youtubePolls` row exists for the market,
  `resolveMarket` throws "No poll data for market X". `resolveNow` should catch this and
  return `{ error: "No poll data yet — run the poller first or wait for the cron" }`.
- **`createTestMarket` inserts a poll row at creation time**: Like `createMarket`, it
  should insert an initial `youtubePolls` row with the live viewCount/likeCount from
  `fetchVideoStats` so the oracle has data to resolve against immediately.
- **Auth**: All new actions call `isAdmin(session)` from `src/lib/admin.ts`. Never
  inline email comparison (see learnings doc Pattern 6).
- **`resolveNow` on the `quick/page.tsx`**: The quick-create page doesn't need to show
  resolve controls — those live in `AdminMarketActions` on the markets list.
- **`fetchVideoStats` vs `fetchYouTubeStats`**: The quick-create form reuses the existing
  `fetchVideoStats` server action from admin.ts (it already fetches title/thumbnail/channel).
  `fetchYouTubeStats` from oracle.ts is for programmatic single-stat lookup, not the full
  snippet+statistics response needed for the form.

## System-Wide Impact

- **Interaction graph**: "Resolve Now" → `resolveNow(marketId)` → UPDATE status →
  `resolveMarket()` in oracle → DB read (latest poll) → `db.transaction(distributePayout)` →
  user balances updated, market status = "resolved", `revalidatePath` fires.
- **Error propagation**: If `resolveMarket` throws (no poll, DB error), `resolveNow` catches
  it and returns `{ error: string }`. `AdminMarketActions` shows `alert(result.error)`.
- **State lifecycle risks**: `resolveNow` uses `NOT IN ('resolved', 'cancelled')` to avoid
  double-resolution. The oracle's inner `WHERE status='resolving'` guard is a second layer.
- **Idempotency**: If `resolveNow` is clicked twice fast, the second call hits the status
  guard (already "resolved") and no-ops cleanly.

## Acceptance Criteria

- [ ] `/admin/markets/quick` renders without errors, shows URL input + milestone input +
      questionType select + "Fetch" and "Create" buttons
- [ ] Fetching a valid YouTube URL populates title, thumbnail, and channel name
- [ ] Creating a test market results in a DB row with `status="active"`, `bParameter="0.01"`,
      `resolvesAt≈now+48h`, and an initial `youtubePolls` row with the fetched view/like counts
- [ ] Market list at `/admin/markets` shows a "Quick Create →" link
- [ ] "Resolve Now" button appears on `active` and `halted` markets in the admin market list
- [ ] Clicking "Resolve Now" (with poll data present) resolves the market via oracle —
      correct outcome based on latest poll vs milestoneThreshold
- [ ] Clicking "Resolve Now" with no poll data returns an informative error (alert)
- [ ] All new actions return `{ error: "Unauthorized" }` for non-admin sessions
- [ ] No TypeScript build errors

## Implementation Steps

### Step 1 — Add server actions to `src/lib/actions/admin.ts`

**`createTestMarket(videoUrl: string, milestoneThreshold: number, questionType: "views" | "likes")`**

```ts
// 1. isAdmin(session) check
// 2. extractVideoId(videoUrl) — reuse existing helper
// 3. fetchVideoStats (inline call, same as existing action, or call fetchVideoStats action directly)
//    - OR: replicate the YouTube API fetch inline (simpler — no circular action call)
// 4. Compute:
//    const now = new Date()
//    const resolvesAt = new Date(now.getTime() + 48 * 60 * 60 * 1000)
//    const haltsAt = new Date(resolvesAt.getTime() - 5 * 60 * 1000)
//    const b = 0.01
//    const [priceYes, priceNo] = allPrices([0, 0], b)
// 5. db.transaction:
//    - INSERT markets row (status="active", bParameter="0.01", opensAt=now, haltsAt, resolvesAt)
//    - INSERT priceSnapshots (priceYes, priceNo)
//    - INSERT youtubePolls (viewCount, likeCount)
// 6. revalidatePath("/admin/markets")
// 7. return { success: true, marketId }
```

**`resolveNow(marketId: string): Promise<{ success: true } | { error: string }>`**

```ts
// 1. isAdmin(session) check
// 2. SELECT market — return { error: "Market not found" } if missing
// 3. Guard: if status in ["resolved", "cancelled"] → return { error: "Already finalized" }
// 4. UPDATE markets SET status="resolving" WHERE id=? AND status NOT IN ("resolved","cancelled")
// 5. try { await resolveMarket(marketId) }
//    catch (err) { return { error: err.message } }
// 6. revalidatePath("/admin/markets")
// 7. return { success: true }
```

### Step 2 — Update `src/components/AdminMarketActions.tsx`

Add import for `resolveNow`. Add button block for active/halted:

```tsx
{(status === "active" || status === "halted") && (
  <button
    onClick={() => {
      if (confirm("Resolve using oracle (latest poll data)?")) {
        handleAction(() => resolveNow(marketId));
      }
    }}
    disabled={isPending}
    className="px-2 py-1 text-xs bg-yellow-500/10 text-yellow-500 rounded hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
  >
    Resolve Now
  </button>
)}
```

### Step 3 — Create `src/app/admin/markets/quick/page.tsx`

Client component (`"use client"`). State:
- `videoUrl: string` — input
- `videoStats: VideoStatsSuccess | null` — from fetchVideoStats
- `milestone: string` — input
- `questionType: "views" | "likes"` — select
- `isFetching: boolean`, `isCreating: boolean`, `error: string`, `created: boolean`

Layout:
```
<h1>Quick Test Market</h1>
<section>
  URL input + "Fetch" button
  [if videoStats]: thumbnail, title, channel display
  Milestone input (number)
  Question type select
  "Create Test Market" button
  [if created]: ✓ Created — link to /admin/markets
  [if error]: error message
</section>
```

On "Fetch": calls `fetchVideoStats(videoUrl)`.
On "Create": calls `createTestMarket(videoUrl, milestone, questionType)`.

### Step 4 — Update `src/app/admin/markets/page.tsx`

Add a single line below the "Create Market →" link (or the stats row):

```tsx
<a href="/admin/markets/quick" className="text-xs text-muted hover:text-foreground">
  Quick Create (test) →
</a>
```

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| `createTestMarket` bypasses b≥1 validation | Action is admin-gated; hardcoded b=0.01 not user-input — no injection surface |
| `resolveNow` on market with no poll → oracle throws | Caught by try/catch, returns `{ error: "..." }` with human-readable message |
| Double-click on "Resolve Now" before page refreshes | Status guard + oracle idempotency guard provide two layers of protection |
| `createTestMarket` fetches YouTube API inline (not via the Server Action) | The new action calls the YouTube API directly (same pattern as `fetchVideoStats`) to avoid circular server-action calls |

## Sources & References

### Internal References

- Existing actions to extend: `src/lib/actions/admin.ts`
- Component to update: `src/components/AdminMarketActions.tsx`
- Markets list page: `src/app/admin/markets/page.tsx`
- Oracle function: `src/lib/oracle.ts` — `resolveMarket(marketId)`
- `fetchVideoStats` pattern: `src/lib/actions/admin.ts:61`
- `isAdmin` auth helper: `src/lib/admin.ts`
- `allPrices` / `priceSnapshot` insert pattern: `src/lib/actions/admin.ts:129` (`createMarket`)
- YOUTUBE_API_BASE, YT_TIMEOUT_MS, YOUTUBE_THUMBNAIL_RE: `src/lib/constants.ts`
- `extractVideoId`: `src/lib/youtube.ts`
- `VideoStatsSuccess` exported type: `src/lib/actions/admin.ts:47`

### Learnings Applied

- **Admin auth (Pattern 6)**: all new actions call `isAdmin(session)` — never inline email check
- **YouTube fields filter**: `fetchVideoStats` already has the correct `fields` string — reuse
  the same fetch pattern in `createTestMarket`
- **Server actions as leaf nodes**: `createTestMarket` does not call `fetchVideoStats` action;
  it fetches YouTube inline to avoid double-call chain
- **Reset state before `await`** (LLM pipeline doc): quick-create form resets `videoStats`
  and `error` before calling `fetchVideoStats` to avoid stale state on re-fetch
