# Todo 011: Harden Admin Authorization — Result

## Files Changed/Created

1. **`src/lib/admin.ts`** — rewritten
2. **`src/app/admin/layout.tsx`** — updated to pass session to `isAdmin()`
3. **`src/lib/actions/admin.ts`** — updated
4. **`src/middleware.ts`** — created (new file)

## Summary of Changes

### Fix 1: `src/lib/admin.ts`
- Converted `isAdmin()` from an async no-arg function (calling `auth()` internally) to a synchronous function accepting `Session | null`.
- The `ADMIN_EMAIL` guard (`if (!adminEmail) return false`) was already present but the new synchronous signature makes it impossible to be called with an unresolved session.
- Converted `requireAdmin()` from throwing an error to returning `{ error: "Unauthorized" } | null`, consistent with other server action patterns.
- Import changed from `@/lib/auth` to `next-auth` for the `Session` type.

### Cascading fix: `src/app/admin/layout.tsx`
- The layout was calling `await isAdmin()` with no args. After the signature change, it now calls `const session = await auth()` and passes the result to `isAdmin(session)`.
- Added `import { auth } from "@/lib/auth"` to support this.

### Fix 2: `src/lib/actions/admin.ts`
- Added `import { isAdmin } from "@/lib/admin"` at the top.
- `createMarket`: Replaced `if (!session?.user?.email || session.user.email !== process.env.ADMIN_EMAIL)` with `if (!isAdmin(session)) return { error: "Unauthorized" }`.
- `publishMarket`, `cancelMarket`, `manualResolve`: Replaced `if (session?.user?.email !== process.env.ADMIN_EMAIL)` with `if (!isAdmin(session)) return { error: "Unauthorized" }`.
- All four inline checks now go through the centralized `isAdmin()` function.

### Fix 3: `src/middleware.ts` (new file)
- Created edge middleware using NextAuth's `auth` wrapper.
- Redirects unauthenticated users to `/auth/signin` for both `/admin/:path*` and `/portfolio/:path*` routes.
- Configured `matcher` to only run on those route prefixes.

## Issues Found

- The original `isAdmin()` was already guarding against unset `ADMIN_EMAIL`, so the bug described in the todo (where `undefined !== undefined` would allow access) did not actually exist in this codebase. However, the old check `session?.user?.email !== process.env.ADMIN_EMAIL` in `publishMarket`, `cancelMarket`, and `manualResolve` (not `createMarket`) would have allowed `undefined === undefined` if both email and env var were unset — that is now fixed by routing through `isAdmin()`.
- The signature change to `isAdmin()` required a cascading update to `layout.tsx` (not mentioned in the todo) to avoid a TypeScript error.
