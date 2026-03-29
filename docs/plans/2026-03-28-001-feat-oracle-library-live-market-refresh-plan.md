---
title: "feat: Oracle Library Extraction + Live Market Page SWR Refresh"
type: feat
status: completed
date: 2026-03-28
origin: docs/brainstorms/2026-03-28-oracle-and-live-market-page-requirements.md
---

# feat: Oracle Library Extraction + Live Market Page SWR Refresh

## Overview

Extract the YouTube polling and market resolution logic currently embedded in two Vercel cron
route handlers into a shared `src/lib/oracle.ts` library. Then wire the market detail page to
auto-refresh dynamic sections (odds, trades, price chart, stats chart) every 60 seconds via SWR
— without breaking the SSR initial render.

Two independent sub-problems: (1) a testable oracle boundary, (2) a live-updating market page.

## Problem Statement / Motivation

- **No shared oracle boundary**: `fetchYouTubeStats` logic lives in `poll-youtube/route.ts`;
  `determineOutcome` + resolution logic lives in `resolve-markets/route.ts`. Neither can be
  unit-tested or invoked programmatically without going through HTTP.
- **Stale market page**: The market detail page is a pure server component. Users see stale
  odds, trades, and stats unless they manually reload — undermining the live prediction-market
  experience.

## Proposed Solution

Three discrete changes, each independently shippable:

1. **Create `src/lib/oracle.ts`** — two exported async functions: `fetchYouTubeStats` and
   `resolveMarket`. Cron routes call these instead of embedding the logic.
2. **Refactor cron routes** — thin handlers that delegate to the oracle library. Zero
   behavioral change.
3. **SWR live market page** — extract a `MarketLiveData` client component that uses `useSWR`
   with `fallbackData` from the server component's initial DB fetch. The page still hydrates
   instantly; SWR refreshes every 60 seconds.

## Key Research Findings

- **SWR already installed**: `swr ^2.4.1` in `package.json:29` — no new package needed.
- **`GET /api/markets/[id]` already exists**: `src/app/api/markets/[id]/route.ts` returns
  prices, priceHistory, recentTrades, pollHistory — exactly the shape needed. All BigInt fields
  are already serialized (`milestoneThreshold.toString()`, `Number(viewCount)`).
- **`pollHistory.time` is ISO string**: The API response uses `p.polledAt.toISOString()`, not
  a Unix timestamp. The client component must convert:
  `Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp`.
- **`db` singleton is server-only**: `src/db/index.ts` uses `neon-serverless` — never import
  `oracle.ts` or any DB module in a `"use client"` component.
- **`distributePayout(tx, marketId, outcome)`**: Must be called inside `db.transaction()`.
  `resolveMarket` opens the transaction.
- **Vercel cron**: Both jobs run every `*/5 * * * *`. 60s SWR refresh is appropriate — fresh
  enough, not over-polling.
- **`shouldPoll`**: Adaptive polling tier function — stays in the cron route (scheduling
  concern, not oracle concern).

## Technical Considerations

- `oracle.ts` is server-only (imports `db`, calls YouTube API with `process.env.YOUTUBE_API_KEY`).
  Next.js build will error if imported client-side.
- `fetchYouTubeStats` is a single-video helper. The cron poll route currently batches 50 video
  IDs per API request for quota efficiency. **Decision**: the batch loop stays in the cron
  route; `fetchYouTubeStats` is used for single-video programmatic calls. The refactor only
  extracts the per-video logic, not the batch orchestration.
- `resolveMarket` must use `.where(and(eq(markets.id, id), eq(markets.status, "resolving")))`
  guard (idempotency — concurrent cron runs cannot double-resolve).
- `ChannelHistorySection` is an async Server Component. It cannot be moved inside a `"use
  client"` tree. Pass it as `children` from `page.tsx` to `MarketLiveData`.
- `TradePanel` currently calls `router.refresh()` (line 71) after a successful buy. Replace
  with `onTradeSuccess?: () => void` callback so `MarketLiveData` passes `() => mutate()` —
  immediate SWR revalidation instead of a full RSC tree refresh.
- `recentTrades` in the API response has `shares`/`cost` already as `number` (parsed in the
  route). Do not call `parseFloat()` again in the client component.

## System-Wide Impact

- **Interaction graph**: Cron → `fetchYouTubeStats()` → YouTube API → DB insert. Cron →
  `resolveMarket()` → DB read (latest poll) → `db.transaction(distributePayout)` → DB write.
- **Error propagation**: `fetchYouTubeStats` throws on network failure; cron routes catch
  per-market and continue. `resolveMarket` throws on DB error; route catches, marks market
  `"failed"`, continues. No change from current behavior.
- **State lifecycle risks**: `resolveMarket` uses the existing idempotency pattern — the status
  guard in the `.where()` clause prevents re-entry. The `active→halted→resolving` state
  transitions remain in the route handler.
- **TradePanel mutate**: After the change, `buyShares` success calls `onTradeSuccess()` →
  `mutate()` → immediate re-fetch of `/api/markets/${id}`. This replaces `router.refresh()`
  which caused full RSC tree revalidation.

## Acceptance Criteria

- [ ] `src/lib/oracle.ts` exports `fetchYouTubeStats(videoId: string)` and
      `resolveMarket(marketId: string)`
- [ ] `poll-youtube/route.ts` delegates to oracle.ts (no inline single-video YouTube API logic
      that duplicates what oracle.ts does)
- [ ] `resolve-markets/route.ts` calls `resolveMarket(market.id)` — no inline `determineOutcome`
- [ ] Existing cron behavior is unchanged: same polling tiers, same state machine, same payouts
- [ ] `resolveMarket` executes status update + payout in one DB transaction
- [ ] Market page odds, charts, and trades refresh every 60s without page reload
- [ ] Initial page render is still SSR — zero loading flicker on first load (fallbackData)
- [ ] After a successful buy, SWR immediately revalidates (no stale odds after trade)
- [ ] A "last updated" indicator shows when data was last fetched
- [ ] `ChannelHistorySection` continues to server-render (passed as `children`)
- [ ] No TypeScript build errors; no import of server-only modules in client components

## Implementation Order

### Phase 1 — Oracle Library (no user-visible change)

**Step 1: Create `src/lib/oracle.ts`**

```ts
// Exports:
export async function fetchYouTubeStats(
  videoId: string
): Promise<{ viewCount: number; likeCount: number; timestamp: Date } | null>
// - Calls YOUTUBE_API_BASE/videos?part=statistics&id=<videoId>
// - Uses cache: "no-store" and AbortSignal.timeout(YT_TIMEOUT_MS)
// - Returns null if video deleted/private (stats absent from response)
// - Throws on network/API error (let callers decide recovery)
// - Uses YOUTUBE_API_KEY from process.env inline (not module-level)

export async function resolveMarket(marketId: string): Promise<void>
// - SELECT latest youtubePolls row for marketId (ORDER BY polledAt DESC LIMIT 1)
// - Throws if no poll found
// - outcome: metric >= milestoneThreshold ? 1 : 0 (null metric = 0/NO)
// - db.transaction(async (tx) => {
//     UPDATE markets SET status='resolved', outcome, resolvedAt=now
//       WHERE id=marketId AND status='resolving'   ← idempotency guard
//     distributePayout(tx, marketId, outcome)
//   })
```

**Step 2: Refactor `src/app/api/cron/poll-youtube/route.ts`**

The batch loop (50 IDs per API call) is a quota-optimization concern — keep it in the route.
Only change: after getting stats for a video, the route can optionally call
`fetchYouTubeStats` for the single-video fallback path, or simply keep the existing batch
logic as-is and have `oracle.ts` be the non-batch variant. The key deliverable is that
`oracle.ts` exists as a callable boundary. The cron route stays functionally identical.

**Step 3: Refactor `src/app/api/cron/resolve-markets/route.ts`**

- Remove the `determineOutcome` function (lines ~80–100 of the route file)
- Replace the inline resolution block with: `await resolveMarket(market.id)`
- Keep the `active→halted→resolving` bulk transitions (scheduling logic, not oracle)
- Keep the `try/catch` per-market with `status: "failed"` on error

---

### Phase 2 — Market Page SWR Refresh

**Step 4: Define `MarketData` type**

In `src/types/market.ts` (or add to `src/types/index.ts` if it exists), define the
API response shape that both the server page and `MarketLiveData` use:

```ts
export interface MarketData {
  id: string;
  title: string;
  description: string | null;
  status: MarketStatus;
  questionType: QuestionType;
  milestoneThreshold: string;       // BigInt serialized as string
  youtubeVideoId: string;
  videoMetadata: { ... } | null;
  priceYes: number;
  priceNo: number;
  outcome: number | null;
  resolvesAt: string | null;        // ISO string
  resolvedAt: string | null;        // ISO string
  priceHistory: Array<{ time: string; priceYes: number; priceNo: number; volumeTotal: number }>;
  recentTrades: Array<{ id: string; outcome: number; shares: number; cost: number; ... }>;
  pollHistory: Array<{ time: string; viewCount: number | null; likeCount: number | null }>;
}
```

**Step 5: Create `src/components/MarketLiveData.tsx`** (`"use client"`)

```tsx
// Props:
interface Props {
  marketId: string;
  session: Session | null;
  initialData: MarketData;
  children?: React.ReactNode;  // ChannelHistorySection from server
}

// SWR hook:
const { data, mutate } = useSWR<MarketData>(
  `/api/markets/${marketId}`,
  (url) => fetch(url).then(r => r.json()),
  { refreshInterval: 60_000, fallbackData: initialData }
);

// Chart data conversions:
const chartData = data.priceHistory.map(h => ({
  time: Math.floor(new Date(h.time).getTime() / 1000) as UTCTimestamp,
  value: h.priceYes,
}));

const statsChartData = data.pollHistory
  .filter(p => data.questionType === "views" ? p.viewCount != null : p.likeCount != null)
  .map(p => ({
    time: Math.floor(new Date(p.time).getTime() / 1000) as UTCTimestamp,
    value: data.questionType === "views" ? p.viewCount! : p.likeCount!,
  }));

// Renders the full market grid (status badge, countdown, title, 3-col grid, LastUpdated)
// Passes mutate: () => mutate() to TradePanel via onTradeSuccess
// Renders {children} inside the left column where ChannelHistorySection was
```

**Step 6: Update `src/components/TradePanel.tsx`**

```tsx
// Add to props interface:
onTradeSuccess?: () => void;

// Line 71 — replace:
router.refresh();
// With:
onTradeSuccess?.();

// Remove useRouter import if it has no other uses after this change
```

**Step 7: Create `src/components/LastUpdated.tsx`** (`"use client"`)

```tsx
// Props: updatedAt: Date
// Shows: "Updated X seconds ago" — ticks every 10s
// Uses useEffect + setInterval for the tick
// Display format: "just now" < 15s, "Xs ago" for < 60s, "Xm ago" for minutes
```

**Step 8: Refactor `src/app/markets/[id]/page.tsx`**

The server component:
1. Keeps all current DB queries (market, trades, priceHistory, pollHistory) — needed for
   `initialData` / SSR
2. Builds `initialData: MarketData` from DB results (same data, different shape)
3. Removes inline rendering of: odds display, TradePanel, VideoStatsChart, PriceChart,
   recent trades table, market details grid
4. Keeps: video embed `<iframe>`, `<VideoDescription>`, `<Suspense><ChannelHistorySection /></Suspense>`
5. Renders `<MarketLiveData marketId={id} session={session} initialData={initialData}>` with
   `<ChannelHistorySection>` passed as children

```tsx
// page.tsx becomes approximately:
return (
  <div className="max-w-6xl mx-auto px-4 py-6">
    {/* Static: video embed */}
    <div className="aspect-video ..."><iframe ... /></div>

    {/* Static: description */}
    {videoMetadata?.description && <VideoDescription ... />}

    {/* Dynamic: everything else — server channel history threaded as children */}
    <MarketLiveData marketId={id} session={session} initialData={initialData}>
      {videoMetadata?.channelId && (
        <Suspense fallback={...}>
          <ChannelHistorySection channelId={videoMetadata.channelId} />
        </Suspense>
      )}
    </MarketLiveData>
  </div>
);
```

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| `oracle.ts` imported in client component → build error | Add a comment header `// server-only` or use `import "server-only"` to get a clear build error |
| `pollHistory.time` ISO string → wrong chart timestamps | Convert with `new Date(p.time).getTime()`, not `p.time` directly |
| `recentTrades.shares`/`cost` are already `number` in API response | Do not `parseFloat()` in client — will still work but is wasteful; just use directly |
| `mutate()` vs `router.refresh()` regression | `mutate()` only updates the SWR cache key; status badge + title (if moved to client) update too. Keep `router.refresh()` as fallback or verify all changed fields are inside `MarketLiveData` |
| `SellButton` also calls `router.refresh()` | Check `src/components/SellButton.tsx` — if it's rendered inside `MarketLiveData`, it also needs an `onTradeSuccess` callback |

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-28-oracle-and-live-market-page-requirements.md](docs/brainstorms/2026-03-28-oracle-and-live-market-page-requirements.md)
  Key decisions carried forward: (1) two cron routes retained with independent schedules,
  (2) full market data refresh not just stats-only, (3) server shell + SWR client section.

### Internal References

- Cron route to refactor (poll): `src/app/api/cron/poll-youtube/route.ts`
- Cron route to refactor (resolve): `src/app/api/cron/resolve-markets/route.ts`
- SWR data source (already complete): `src/app/api/markets/[id]/route.ts`
- Page to refactor: `src/app/markets/[id]/page.tsx`
- `distributePayout`: `src/lib/services/payout.ts:11`
- `TradePanel` router.refresh: `src/components/TradePanel.tsx:71`
- `SellButton` (check for router.refresh): `src/components/SellButton.tsx`
- `YOUTUBE_API_BASE`, `YT_TIMEOUT_MS`: `src/lib/constants.ts`
- DB singleton (server-only): `src/db/index.ts`
- SWR package: `package.json:29`

### Learnings Applied

- **Cron state machine idempotency** (code-review-patterns Pattern 5): `resolveMarket` uses
  `.where(status='resolving')` guard
- **Oracle polling index** (Pattern 9): composite index `(marketId, polledAt)` already exists
  on `youtube_polls` — `ORDER BY polledAt DESC LIMIT 1` is covered
- **No module-level SDK init** (anthropic-sdk doc Pattern 1): `YOUTUBE_API_KEY` read inline
  in function body, not at module level
- **SWR handles stale deduplication internally** — no need for `useRef` cancellation token
  pattern (that pattern applies to manual `async/await` in event handlers, not `useSWR`)
