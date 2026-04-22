import { NextResponse } from "next/server";

/**
 * Production gate for Slice C's admin-lifecycle bearer routes (resolve-now,
 * DELETE /[id], delete-preview). Keeps them off in production until the
 * Slice B P0 bearer floor-guard bypass is closed — a leaked CRON_SECRET
 * shouldn't compound market-creation abuse with cancel/resolve/delete abuse.
 *
 * Dev and staging set ADMIN_BEARER_LIFECYCLE_ENABLED=true so Slice C's UI
 * works end-to-end. Production flips the flag after the P0 ships.
 *
 * Returns null when the gate is open (proceed), or a 503 NextResponse when
 * the gate is closed. Callers early-return on non-null.
 */
export function requireAdminLifecycleEnabled(): NextResponse | null {
  if (process.env.ADMIN_BEARER_LIFECYCLE_ENABLED !== "true") {
    console.warn("[admin-lifecycle] route gated off");
    return NextResponse.json(
      { error: "Feature disabled" },
      { status: 503 },
    );
  }
  return null;
}
