/**
 * SINGLE-PROCESS, IN-MEMORY sliding-window rate limiter.
 *
 * Ported from clipmarket/src/lib/rate-limit.ts. Each Vercel serverless
 * worker has its own Map — attacker throughput scales with instance count.
 * Acceptable at current single-operator scale; revisit with Upstash/Redis
 * if clipmarket/virality deploy multi-region or to a worker pool.
 *
 * V5 of Slice C wraps this around all admin bearer lifecycle routes.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

const buckets = new Map<string, number[]>();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
  now: number = Date.now(),
): RateLimitResult {
  const { limit, windowMs } = opts;
  const cutoff = now - windowMs;
  const timestamps = buckets.get(key) ?? [];
  const fresh = timestamps.filter((t) => t > cutoff);

  if (fresh.length >= limit) {
    const oldest = fresh[0];
    return { ok: false, retryAfterMs: oldest + windowMs - now };
  }

  fresh.push(now);
  buckets.set(key, fresh);
  return { ok: true };
}

export function __resetRateLimitForTests(): void {
  buckets.clear();
}

/**
 * Derive a rate-limit bucket key from the bearer token via SHA-256.
 *
 * Using a hash of the bearer (not the plaintext, not the IP) means:
 *   - Two callers with different secrets land in different buckets.
 *   - The bucket key never logs the raw secret.
 *   - No single "bearer:unknown" collision bucket for authenticated callers.
 *
 * Falls back to x-forwarded-for / x-real-ip only if the Authorization
 * header is absent (which shouldn't happen post-verifyCronAuth).
 */
function bucketKey(request: Request): string {
  const auth = request.headers.get("authorization");
  if (auth) {
    const digest = createHash("sha256").update(auth).digest("hex");
    return `bearer:${digest.slice(0, 16)}`;
  }
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  return `ip:${ip}`;
}

/**
 * Admin-route rate-limit wrapper. Returns null to pass through, or a
 * 429 NextResponse with a Retry-After header when the bucket is full.
 *
 * Call at the top of each admin bearer route, AFTER verifyCronAuth so
 * unauthenticated callers are already rejected.
 */
export function applyAdminRateLimit(
  request: Request,
  opts: { limit: number; windowMs: number },
): NextResponse | null {
  const key = bucketKey(request);
  const result = checkRateLimit(key, opts);

  if (result.ok) return null;

  return NextResponse.json(
    { error: "Rate limit exceeded" },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
      },
    },
  );
}
