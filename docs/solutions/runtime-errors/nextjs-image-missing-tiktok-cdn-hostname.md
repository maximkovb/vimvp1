---
title: Revert UI to doomscroll baseline and fix TikTok CDN image hostname error
category: runtime-errors
date: 2026-04-07
tags: [next.js, git, image-optimization, csp, tiktokcdn, next-config, revert, remote-patterns]
components: [next.config.ts, feat/mobile-doomscroll-ui]
symptoms:
  - "Next.js runtime error: Invalid src prop on next/image, hostname not configured"
  - "Images from *.tiktokcdn-us.com fail to load after branch revert"
  - "Content Security Policy blocks TikTok CDN image sources"
---

## Problem

After reverting the virality project to the known-good UI baseline (`feat/mobile-doomscroll-ui` @ `e9b6225`), Next.js throws:

> "Invalid src prop on next/image, hostname `p16-common-sign.tiktokcdn-us.com` is not configured under images in `next.config.js`"

TikTok CDN serves images from `*.tiktokcdn-us.com` (US-region CDN), which is absent from the baseline commit's `next.config.ts`.

## Root Cause

Two issues compound:

1. **Missing image hostname** — The `e9b6225` commit's `next.config.ts` does not include `*.tiktokcdn-us.com` in either `remotePatterns` or the CSP `img-src` directive. This domain was added in a later commit that no longer exists on the reverted branch.

2. **Git revert process** — Local changes to `next.config.ts` must be discarded before switching branches, otherwise `git checkout` is blocked or carries over stale config from the previous branch.

## Solution

In `next.config.ts`, add the missing TikTok US CDN hostname in two places:

**`remotePatterns` array:**
```ts
{ protocol: "https", hostname: "*.tiktokcdn-us.com" },
```

**CSP `img-src` directive:**
```ts
"img-src 'self' https://*.tiktokcdn.com https://*.tiktokcdn-us.com data: blob:"
```

## Steps

1. Discard any local `next.config.ts` changes before switching branches:
   ```bash
   git checkout -- next.config.ts
   ```

2. Switch to the safety fallback branch and reset to the known-good commit:
   ```bash
   git checkout feat/mobile-doomscroll-ui
   git reset --hard e9b6225
   ```

3. Add `{ protocol: "https", hostname: "*.tiktokcdn-us.com" }` to the `remotePatterns` array in `next.config.ts`.

4. Add `https://*.tiktokcdn-us.com` to the CSP `img-src` directive in `next.config.ts`.

5. Restart the dev server and verify no image hostname errors appear.

## Safety Fallback Reference

The canonical revert target for the virality project is: *(auto memory [claude])*

- **Branch:** `feat/mobile-doomscroll-ui`
- **Commit:** `e9b6225` — doomscroll scrolling feed, desktop side HUD with buy/sell, purple/black color scheme, yes=green / no=red buttons

This is the designated baseline for any "revert everything" situation.

## Prevention

- After any revert, always treat `next.config.ts` as the first file to audit — image domains and CSP headers are infrastructure that evolve independently of branch UI state.
- Consider cherry-picking the TikTok CDN hostname fix directly into the `e9b6225` baseline commit (or tag a new clean baseline that includes it), so future reverts don't require a manual config patch.
- When adding a new external image domain anywhere in the codebase, update `next.config.ts` and commit it to all long-lived branches immediately.

## Post-Revert Checklist

- [ ] `next.config.ts` `images.remotePatterns` includes all active CDN domains (TikTok, YouTube)
- [ ] CSP `img-src` in `next.config.ts` matches those same domains
- [ ] Open a page that renders external images — check browser console for `Invalid src prop` errors
- [ ] Verify `.env.local` environment variables match what the reverted code expects
- [ ] Run any pending database migrations (schema may have diverged)
- [ ] Smoke-test the core user flow: browse videos → place a prediction

## Notes

- Next.js `remotePatterns` `hostname: "*.tiktokcdn-us.com"` matches one level of subdomain only — `p16-common-sign.tiktokcdn-us.com` matches, but `a.b.tiktokcdn-us.com` would not.
- The CSP `img-src` and Next.js `remotePatterns` are **independent** — a domain missing from one but not the other produces different errors (runtime throw vs. silent browser CSP violation). Always update both.
- `tiktokcdn-us.com` is the US-region CDN. The non-US CDN is `tiktokcdn.com` (already present). International content may introduce other regional variants.

## Related

- `docs/plans/2026-04-02-001-fix-video-embed-not-showing-plan.md` — addresses the CSP `media-src` side of TikTok embed blocking (companion to this fix)
- `docs/plans/2026-03-30-001-feat-replace-tikapi-with-tikwm-plan.md` — explains why `tiktokcdn-us.com` appears (TikWM API returns US-region CDN URLs for video cover images)
