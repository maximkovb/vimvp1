---
status: pending
priority: p1
issue_id: "108"
tags: [code-review, performance, architecture, database]
dependencies: []
---

# Move user balance DB query out of AppShell layout

## Problem Statement

`AppShell` is a server async component in `RootLayout`. It calls `auth()` + a `SELECT balance FROM users` query on every full page request across every route in the app. Combined with the 3 queries in `page.tsx`, this means every homepage load holds Neon's single connection for 4–5 sequential operations. At any concurrent load this creates a serial queue that degrades all routes, not just the home page.

## Findings

- `src/components/AppShell.tsx:10-20`: `await auth()` + `db.select({ balance })...where(eq(users.id, session.user.id))`
- `src/db/index.ts:15`: `max: 1` connection pool — every concurrent request queues behind the last
- Architecture agent: balance is user-specific interactive state; it does not belong in a layout server component
- Performance agent: at 10 concurrent users, p99 latency stacks linearly on the single connection
- `auth()` alone is acceptable in layout (Next.js deduplicates via request cache); the DB call is the problem

## Proposed Solutions

### Option 1: Move balance fetch to client-side SWR in BalanceChip

**Approach:** Remove DB query from `AppShell`. Add a `BalanceChip` client component that fetches `/api/balance` (already exists) via SWR. `SidebarClient` and `BottomNavClient` render `<BalanceChip>` instead of receiving `initialBalance` as a prop.

```tsx
// AppShell.tsx — remove DB query, only pass session
export async function AppShell({ children }) {
  const session = await auth();
  const admin = isAdmin(session);
  return (
    <div className="min-h-screen flex">
      <aside ...>
        <SidebarClient session={session} isAdmin={admin} />
      </aside>
      ...
    </div>
  );
}

// BalanceChip.tsx (client)
const { data } = useSWR('/api/balance', fetcher);
```

**Pros:** Eliminates DB round-trip from every layout render; balance updates reactively after trades; `/api/balance` already exists
**Cons:** Balance shows as loading briefly on first render (acceptable — shows skeleton)

**Effort:** 1 hour
**Risk:** Low

### Option 2: Streaming with async server component leaf

**Approach:** Keep AppShell sync. Extract a small `<UserBalanceDisplay>` async server component, wrap in `<Suspense>`. Streams balance in without blocking layout render.

**Pros:** No client-side SWR; balance is server-authoritative
**Cons:** Requires streaming-compatible deployment; slightly more complex

**Effort:** 1.5 hours
**Risk:** Medium

## Recommended Action

Option 1 — move to client SWR on `/api/balance`. The endpoint already exists and is already used by `TradePanel`. This is the most direct fix.

## Technical Details

**Affected files:**
- `src/components/AppShell.tsx:10-20` — remove DB import and balance query
- `src/components/SidebarClient.tsx` — remove `initialBalance` prop, add BalanceChip
- `src/components/BottomNavClient.tsx` — remove `initialBalance` prop if present
- New file (or inline): `BalanceChip` client component using SWR

## Acceptance Criteria

- [ ] `AppShell` makes no DB calls — only `auth()`
- [ ] Balance is still displayed in sidebar and bottom nav
- [ ] Balance updates after a successful trade without page reload

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (performance-oracle + architecture-strategist agents)
