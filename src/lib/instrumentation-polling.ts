import { pollAllActiveMarkets } from "@/lib/poll-active-markets";

declare global {
  // eslint-disable-next-line no-var
  var __pollInterval: ReturnType<typeof setInterval> | undefined;
}

// 10 minutes — mirrors the */10 Vercel cron schedule in vercel.json
const POLL_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Called once from src/instrumentation.ts register() on server startup.
 *
 * Fires an immediate poll for all active/halted markets, then schedules a
 * 10-minute interval in development to mirror Vercel cron behavior locally.
 *
 * In production (Vercel serverless):
 *   - setInterval is NOT scheduled — the process is frozen between requests so
 *     intervals don't tick. Vercel cron (vercel.json) handles the regular cadence.
 *   - The startup call still fires on each cold start, covering the first-deploy gap.
 *
 * GlobalThis guard:
 *   - In dev, Next.js 16 can invoke register() 2–3 times across worker evaluations.
 *     The __pollInterval flag prevents duplicate intervals from being created.
 *   - In production, __pollInterval is never set (no setInterval), so the guard never
 *     fires — each cold start polls once, with shouldPoll acting as the rate limiter.
 */
export async function initPolling(): Promise<void> {
  if (globalThis.__pollInterval) {
    console.log("[polling] already running — skipping duplicate register() call");
    return;
  }

  console.log("[polling] server startup — running immediate poll");
  try {
    const result = await pollAllActiveMarkets();
    console.log("[polling] startup poll complete:", result);
  } catch (err) {
    console.error("[polling] startup poll failed:", err);
  }

  if (process.env.NODE_ENV === "development") {
    console.log(
      `[polling] dev mode — scheduling interval every ${POLL_INTERVAL_MS / 60_000} min`
    );
    globalThis.__pollInterval = setInterval(async () => {
      try {
        const result = await pollAllActiveMarkets();
        console.log("[polling] interval poll complete:", result);
      } catch (err) {
        console.error("[polling] interval poll failed:", err);
      }
    }, POLL_INTERVAL_MS);
    // Don't hold the Node.js event loop open if everything else has exited
    globalThis.__pollInterval.unref?.();
  }
}
