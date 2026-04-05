---
status: pending
priority: p1
issue_id: "105"
tags: [code-review, bug, navigation]
dependencies: []
---

# Fix nav active-state false positive — Discover shows active on every route

## Problem Statement

Both `BottomNavClient` and `SidebarClient` use `pathname.startsWith(item.href)` for non-exact items. Since every route starts with `/`, the Discover nav item (href `/`) shows as active on every single page unless `exact: true` is set. The `exact` field is also optional in the inferred type, so future nav items can silently fall into this bug.

## Findings

- `src/components/BottomNavClient.tsx:69`: `const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)`
- `src/components/SidebarClient.tsx:85`: identical pattern
- Discover item has `exact: true` which saves it from the root-prefix collision, but the type does not enforce this
- The `startsWith` fallback means `/portfolio` also matches `/portfolio/anything` — creating false positives if sub-routes are added
- TypeScript infers `exact?: boolean` (optional), so future items added without `exact` silently default to prefix matching

## Proposed Solutions

### Option 1: Make `exact` required and default all current items appropriately

**Approach:** Define an explicit `NavItem` interface with `exact: boolean` (required). All current nav items have non-overlapping prefixes so simply requiring a decision at the call site is sufficient.

```ts
interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact: boolean;
}
const NAV_ITEMS: NavItem[] = [
  { href: "/",            exact: true,  ... },
  { href: "/history",     exact: false, ... },
  { href: "/leaderboard", exact: true,  ... },
  { href: "/portfolio",   exact: false, ... },
  { href: "/profile",     exact: false, ... },
];
```

**Pros:** Catches missing `exact` at compile time; self-documenting
**Cons:** None meaningful

**Effort:** 15 minutes (both files)
**Risk:** Low

### Option 2: Extract shared `NAV_ITEMS` to `src/lib/nav-items.tsx`

**Approach:** Consolidate the duplicated nav arrays (same items defined in both Sidebar and Bottom Nav) into a shared module with a typed `NavItem` interface. Both components import from there.

**Pros:** Eliminates duplication, enforces type at one place
**Cons:** Slightly more refactoring

**Effort:** 30 minutes
**Risk:** Low

## Recommended Action

Option 2 — extract to shared `src/lib/nav-items.tsx` and fix the type at the same time. The duplication is a known P3 finding; fixing both together is efficient.

## Technical Details

**Affected files:**
- `src/components/BottomNavClient.tsx:69`
- `src/components/SidebarClient.tsx:85`

## Acceptance Criteria

- [ ] Discover item is NOT highlighted on `/history`, `/portfolio`, `/profile`, `/leaderboard`
- [ ] TypeScript error if a future `NavItem` omits the `exact` field
- [ ] Both sidebar and bottom nav behave identically

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (kieran-typescript-reviewer agent)
