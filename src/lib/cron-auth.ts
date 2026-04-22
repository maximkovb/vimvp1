import { NextResponse } from "next/server";
import { timingSafeEqual, createHmac, randomBytes } from "crypto";

// Per-process key: HMAC-normalizes both sides to a fixed length before comparison,
// eliminating the length-based timing oracle of a direct Buffer comparison.
const HMAC_KEY = randomBytes(32);

function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", HMAC_KEY).update(a).digest();
  const hb = createHmac("sha256", HMAC_KEY).update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verify cron endpoint authorization using timing-safe comparison.
 * Returns a NextResponse error if unauthorized, or null if valid.
 */
export function verifyCronAuth(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Don't confirm server misconfiguration to unauthenticated callers —
    // return the same 401 they'd see for a wrong secret. Log for the operator.
    console.error("[cron-auth] CRON_SECRET not configured");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (!safeEqual(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
