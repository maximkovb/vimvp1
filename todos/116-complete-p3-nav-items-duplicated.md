---
status: pending
priority: p3
issue_id: "116"
tags: [code-review, quality, navigation]
dependencies: [105]
---

# Extract shared NAV_ITEMS to `src/lib/nav-items.tsx`

## Problem Statement

The same 5 nav items (href, label, SVG icon) are defined in both `BottomNavClient.tsx` and `SidebarClient.tsx`. Updating a nav label or adding a tab requires changes in two files. This has already caused a real issue: icon sizes differ (22px vs 20px) between the two files with no clear reason. Fix todo #105 (nav active-state) at the same time as this extraction.

## Findings

- `src/components/BottomNavClient.tsx:6-82`: full `NAV_ITEMS` array with icons
- `src/components/SidebarClient.tsx`: duplicate `NAV_ITEMS` with slightly different icon sizes
- TypeScript agent: "Adding a nav item in one file and forgetting the other will cause real bugs"
- Also fixes todo #105 since the `NavItem` type can enforce `exact: boolean` in one place

## Proposed Solutions

### Option 1: Extract to `src/lib/nav-items.tsx`

```ts
export interface NavItem {
  href: string;
  label: string;
  icon: (size?: number) => React.ReactNode;
  exact: boolean;
}

export const NAV_ITEMS: NavItem[] = [ ... ];
```

Both components import from `@/lib/nav-items` and call `item.icon(22)` or `item.icon(20)` as needed.

**Effort:** 45 minutes
**Risk:** Low

## Acceptance Criteria

- [ ] Single source of truth for nav items
- [ ] Both sidebar and bottom nav render identical items
- [ ] TypeScript error if `exact` is omitted from any item

## Work Log

### 2026-04-05 - Found in code review

**By:** Claude Code (kieran-typescript-reviewer + code-simplicity-reviewer agents)
