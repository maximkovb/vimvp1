---
status: pending
priority: p2
issue_id: "011"
tags: [code-review, security, architecture]
dependencies: []
---

# Harden Admin Authorization — Role Column, Middleware, Consistent Guards

## Problem Statement

Admin authorization has three weaknesses: (1) single `ADMIN_EMAIL` env var with no DB role — privilege is granted by email string comparison, bypassed if the env var is unset; (2) no `middleware.ts` — admin routes are protected only by layout redirect and per-action inline checks; (3) the four admin actions each re-implement the email check inconsistently, and the `requireAdmin()` helper in `lib/admin.ts` is never called.

## Findings

- `src/lib/actions/admin.ts:60-63`: `createMarket` uses `!session?.user?.email || session.user.email !== process.env.ADMIN_EMAIL`
- `src/lib/actions/admin.ts:130, 165, 200`: other actions use `session?.user?.email !== process.env.ADMIN_EMAIL`
- Both forms allow access when `ADMIN_EMAIL` env var is unset: `undefined !== undefined` is `false`
- `src/lib/admin.ts:1-16`: `isAdmin()` and `requireAdmin()` helpers exist but are never imported by admin actions
- No `src/middleware.ts` — `/admin/**` routes rely on `src/app/admin/layout.tsx` server component redirect
- A Google OAuth account with the admin email automatically receives admin rights (no extra verification)
- `requireAdmin()` throws but no caller wraps it in try/catch

## Proposed Solutions

### Option 1: Add Role Column + Use requireAdmin() Consistently

**Approach:**
1. Add `role: text("role").$type<"user" | "admin">().notNull().default("user")` to users schema
2. Populate `role = "admin"` for the admin user in the DB (one-time data migration)
3. Update all admin actions to call `isAdmin()` from `lib/admin.ts` which reads the session role
4. Add `src/middleware.ts` to protect `/admin` at the edge

**Pros:** Role stored in DB — survives email changes; consistent; auditable
**Cons:** Requires migration; admin user needs one-time role assignment

**Effort:** 3-4 hours
**Risk:** Low

---

### Option 2: Fix Inline Checks + Add Middleware (No DB Change)

**Approach:** Fix the env-var-bypass bug (`if (!adminEmail) return { error: "Unauthorized" }`), standardize all four actions to use `isAdmin()` from lib/admin.ts, add middleware for route protection.

**Pros:** No migration needed; immediate fix
**Cons:** Doesn't address email-as-identity fragility long-term

**Effort:** 1-2 hours
**Risk:** Low

## Recommended Action

Option 2 as immediate fix; schedule Option 1 as a follow-up for proper role-based access control.

## Technical Details

**Affected files:**
- `src/lib/admin.ts` — fix `isAdmin()` to guard against undefined ADMIN_EMAIL; update `requireAdmin()` to return error object instead of throwing
- `src/lib/actions/admin.ts:60-63, 130, 165, 200` — replace inline checks with `isAdmin()` call
- `src/middleware.ts` — create file with Auth.js session check for `/admin` prefix

**Middleware example:**
```typescript
import { auth } from "@/lib/auth";
export default auth((req) => {
  const isAdminRoute = req.nextUrl.pathname.startsWith("/admin");
  if (isAdminRoute && !req.auth) {
    return Response.redirect(new URL("/auth/signin", req.url));
  }
});
export const config = { matcher: ["/admin/:path*", "/portfolio/:path*"] };
```

## Acceptance Criteria

- [ ] `isAdmin()` returns false when `ADMIN_EMAIL` env var is not set
- [ ] All four admin actions use the shared `isAdmin()` guard
- [ ] `src/middleware.ts` redirects unauthenticated requests to `/admin/**`
- [ ] Unauthenticated users cannot reach admin routes even via direct URL
- [ ] Auth works correctly for legitimate admin access

## Work Log

### 2026-03-22 - Discovery

**By:** Architecture strategist + TypeScript reviewer (code review)
