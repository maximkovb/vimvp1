---
title: "Turbopack Instrumentation Worker unref() Kills setInterval Before Recurring Polls Fire"
category: runtime-errors
date: 2026-04-15
tags:
  - nextjs
  - turbopack
  - instrumentation
  - setInterval
  - unref
  - event-loop
  - dev-mode
  - tiktok-polling
  - worker-context
severity: high
components:
  - src/lib/instrumentation-polling.ts
  - src/instrumentation.ts
problem_type: event-loop-handle-exhaustion
---

## Problem

In Next.js 16.2.1 with Turbopack dev mode, a `setInterval` registered inside the instrumentation hook (`src/instrumentation.ts` → `register()` → `initPolling()`) fired exactly **once** (the async startup poll) and then was permanently silent. Recurring background polls never ran. The only way to trigger a second poll was a manual HTTP call to the cron endpoint.

**Observable symptoms:**

- `[polling] server startup — running immediate poll` appeared in console — confirming `register()` was called and the startup poll ran
- `[polling] dev mode — scheduling interval every N min` appeared — confirming `setInterval()` was called
- `globalThis.__virality_pollInterval` was populated and truthy (the guard for duplicate calls worked correctly)
- No `[polling] interval poll complete` log ever appeared, even after waiting multiple interval cycles
- Reducing the interval from 10 minutes to 2 minutes made no difference
- `force=true` on the startup poll fixed the one-time update but did nothing for continuity
- The Vercel cron config, `distDir` path, and compiled Turbopack chunks all checked out as correct

---

## Root Cause

**`unref()` in a worker context with no other event-loop handles.**

In Next.js 16 + Turbopack dev mode, `src/instrumentation.ts`'s `register()` function does not run in the main router/server process. It runs in an **isolated instrumentation worker** — a separate Node.js worker context that Turbopack spins up specifically to execute `register()`.

This worker has a critical property: **it has no other active event-loop handles**. The HTTP server, file watchers, WebSocket connections, and all persistent handles live in the main router process. The instrumentation worker is a thin shell whose only job is to call `register()`.

Node.js's event loop exits when there are no more **referenced** handles or timers. By default, `setInterval` is referenced — it keeps the worker alive. The `unref()` method marks a timer as "do not keep this process alive if I am the only handle remaining."

The broken code called `globalThis.__virality_pollInterval.unref?.()` immediately after creating the interval. Because the instrumentation worker had **no other handles**, calling `unref()` caused its event loop to drain as soon as the async startup poll's `await` resolved. The worker exited. `globalThis.__virality_pollInterval` held a reference to a dead timer in a dead worker. The interval callback never ran again.

In a process that has other persistent handles (e.g., the main server with an HTTP listener), `unref()` would be harmless — those other handles keep the loop alive and the timer still fires. The Turbopack instrumentation worker is the edge case where `unref()` is lethal.

---

## Investigation Steps

1. **Verified `vercel.json` cron config** — entries were present and correct. Ruled out.
2. **Verified `distDir` path** — `.next/dev/server/instrumentation.js` existed and was being loaded. Ruled out file-not-found.
3. **Inspected Turbopack compiled chunk** — confirmed compiled output matched source; no transpilation artifact mangled the code.
4. **Reduced interval 10 min → 2 min** — startup poll still worked; interval remained silent. Ruled out timing/wait issues.
5. **Added `force=true` to startup poll** — improved startup reliability (bypassed `shouldPoll()` recency and `resolvesAt` guards) but interval was still silent.
6. **Checked DB connection pool** — `max: 1` Pool configuration noted; ruled out as the blocking factor.
7. **Audited `shouldPoll()` guard logic** — could cause silent skips, but `force=true` bypass already removed that variable. Interval still silent.
8. **Traced instrumentation worker lifecycle** — realized Turbopack's instrumentation context is an isolated worker with no other handles. Connected this to `unref()` removing the only thing keeping the worker alive.

---

## Fix

**Before (broken):**

```typescript
// src/lib/instrumentation-polling.ts
export async function initPolling(): Promise<void> {
  if (globalThis.__virality_pollInterval) {
    console.log("[polling] already running — skipping duplicate register() call");
    return;
  }

  console.log("[polling] server startup — running immediate poll");
  try {
    const result = await pollAllActiveMarkets();  // force=false
    console.log("[polling] startup poll complete:", result);
  } catch (err) {
    console.error("[polling] startup poll failed:", err);
  }

  if (process.env.NODE_ENV === "development") {
    globalThis.__virality_pollInterval = setInterval(async () => {
      try {
        const result = await pollAllActiveMarkets();
        console.log("[polling] interval poll complete:", result);
      } catch (err) {
        console.error("[polling] interval poll failed:", err);
      }
    }, 10 * 60 * 1000);
    globalThis.__virality_pollInterval.unref?.();  // ← THE BUG
  }
}
```

**After (fixed):**

```typescript
// src/lib/instrumentation-polling.ts
const DEV_POLL_INTERVAL_MS = 2 * 60 * 1000;

export async function initPolling(): Promise<void> {
  if (globalThis.__virality_pollInterval) {
    console.log("[polling] already running — skipping duplicate register() call");
    return;
  }

  const isDev = process.env.NODE_ENV === "development";

  // force=true in dev: bypass cooldown and resolvesAt guard on every restart
  console.log(`[polling] server startup — running immediate poll (force=${isDev})`);
  try {
    const result = await pollAllActiveMarkets(isDev);
    console.log("[polling] startup poll complete:", result);
  } catch (err) {
    console.error("[polling] startup poll failed:", err);
  }

  if (isDev) {
    console.log(`[polling] dev mode — scheduling interval every ${DEV_POLL_INTERVAL_MS / 60_000} min`);
    globalThis.__virality_pollInterval = setInterval(async () => {
      try {
        const result = await pollAllActiveMarkets(true);
        console.log("[polling] interval poll complete:", result);
      } catch (err) {
        console.error("[polling] interval poll failed:", err);
      }
    }, DEV_POLL_INTERVAL_MS);
    // Do NOT call unref() in dev: the instrumentation worker has no other active
    // event-loop handles, so unref() causes it to exit immediately after the startup
    // poll — the interval never fires. We want this timer to keep the worker alive.
  }
}
```

**Why the fix works:** Removing `unref()` leaves the `setInterval` in its default referenced state. It becomes the sole handle keeping the Turbopack instrumentation worker's event loop alive. Node.js does not exit the worker while a referenced timer is pending. Every 2 minutes the callback fires and polls TikTok.

**Why `force=true` in dev:** The `shouldPoll()` guard checks `resolvesAt` (returns false if null) and a 9-minute recency window. In dev, both the startup poll and interval polls use `force=true` to bypass this guard — ensuring every restart immediately syncs all active markets regardless of prior poll timestamps. In production, the startup poll uses `force=false` to respect the cooldown and avoid double-polling with the Vercel cron.

---

## Key Architectural Insight

> **`unref()` is safe in a process that has other persistent handles. It is lethal in an isolated worker whose only active handle is the timer itself.**

| Context | Other handles present? | `unref()` safe? |
|---------|----------------------|-----------------|
| Main Next.js server process | HTTP listener, file watchers, HMR WebSocket | ✅ Yes |
| Turbopack instrumentation worker | None | ❌ No — worker exits |
| Node.js worker thread running only init code | None | ❌ No — thread exits |
| Vercel/Cloudflare edge worker | No Node.js timer API | N/A |

---

## Prevention

### Rule: Never call `unref()` in the instrumentation hook context

Any timer or handle created inside `src/instrumentation.ts` or transitively called from `register()` must not have `.unref()` called on it.

**Code review detection:** When a diff touches `src/instrumentation.ts` or adds a module called from `register()`, search the call graph for `.unref()`. Flag any occurrence.

**Grep pattern:**
```bash
grep -r "\.unref()" src/instrumentation.ts src/lib/instrumentation-*.ts
```

### Confirming the interval is alive

Healthy log pattern — look for recurring `interval poll complete` lines:
```
[polling] server startup — running immediate poll (force=true)
[polling] startup poll complete: { polled: 2, ... }
[polling] dev mode — scheduling interval every 2 min
# 2 minutes later:
[polling] interval poll complete: { polled: 2, ... }
# 2 minutes later:
[polling] interval poll complete: { polled: 2, ... }
```

Dead-worker pattern (the bug) — only one poll, then silence:
```
[polling] server startup — running immediate poll (force=true)
[polling] startup poll complete: { polled: 2, ... }
[polling] dev mode — scheduling interval every 2 min
(silence)
```

### Generalization: `unref()` danger zones

- `setTimeout(...).unref()` in `register()` — deferred startup never fires
- `net.Socket.unref()` / DB pool keep-alive timers — pool exits, all subsequent queries fail
- Third-party SDKs that internally call `.unref()` on keep-alive sockets — audit SDKs used by any module imported from `register()`

### The inverse problem in production

In production Next.js builds, `register()` runs in the main process (not an isolated worker). There, *forgetting* to call `.unref()` on a background timer prevents graceful shutdown (the timer keeps the event loop alive indefinitely). The correct approach for production: use an explicit `clearInterval()` in a `SIGTERM`/`SIGINT` handler rather than relying on `unref()`.

---

## Cross-References

- [`docs/solutions/logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md`](../logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md) — sibling doc: other `instrumentation-polling.ts` / `pollAllActiveMarkets` failure modes (UTC timestamp bug, null poll row poison)
- [`docs/solutions/logic-errors/tiktok-market-resolution-race-condition.md`](../logic-errors/tiktok-market-resolution-race-condition.md) — covers dual-location interval config and the `shouldPoll` cooldown this interval drives
- [`docs/solutions/runtime-errors/nextjs-swr-three-layer-cache-stale.md`](./nextjs-swr-three-layer-cache-stale.md) — establishes Next.js 16.2.1 dev/prod behaviour differences (framing context)
- **Wiki:** [`pages/architecture/tiktok-polling-live-data.md`](../../../wiki/projects/virality/pages/architecture/tiktok-polling-live-data.md) — canonical architecture reference for the full polling pipeline
