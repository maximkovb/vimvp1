---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, security, credentials]
dependencies: []
---

# Rotate CRON_SECRET — Previous Value Was Hardcoded in VCS

## Problem Statement

The deleted `scripts/poll-local.ps1` contained a hardcoded `CRON_SECRET` value (`vasyakosmos12`) that was committed to the git repository. The secret must be treated as compromised and rotated immediately across all environments (Vercel, .env.local).

## Findings

- `scripts/poll-local.ps1` contained `-H "Authorization: Bearer vasyakosmos12"` hardcoded
- The file was committed to git history — the secret is visible in `git log` even after deletion
- `CRON_SECRET` gates: `POST /api/markets`, `POST /api/admin/market-suggestion`, `GET /api/cron/poll-tiktok`, and all `/api/admin/*` routes
- Anyone with read access to the repo (or its history) can call any admin/cron endpoint
- The replacement `scripts/poll-local.sh` correctly reads from `.env.local` — the rotation just needs to happen

## Proposed Solutions

### Option 1: Rotate immediately (Required)

**Approach:**
1. Generate a new strong secret: `openssl rand -hex 32`
2. Update Vercel environment variable (`CRON_SECRET`) in the Vercel dashboard for all environments (Production, Preview, Development)
3. Update `.env.local` on all developer machines
4. Verify cron and admin routes still work with new secret

**Pros:**
- Eliminates exposure of all admin/cron endpoints
- Takes ~10 minutes

**Cons:**
- Requires coordination if other developers have `.env.local` with old value

**Effort:** 10 minutes

**Risk:** Low (rotation is the safe path; old secret is the risk)

---

### Option 2: Also scrub git history (Optional enhancement)

**Approach:** Use `git filter-repo` to remove the secret from git history, then force-push.

**Pros:**
- Eliminates the secret from all historical commits

**Cons:**
- Rewrites history — all collaborators must re-clone or rebase
- Moderate disruption for a 1-developer project; high disruption for teams
- Does not un-expose it if already synced to any remote forks/clones

**Effort:** 30–60 minutes

**Risk:** Medium (history rewrite)

## Recommended Action

Option 1 (rotation) is mandatory. Option 2 (history scrub) is optional — do it if the repo is public or if other people have cloned it.

## Technical Details

**Affected files:**
- Vercel dashboard → Environment Variables → `CRON_SECRET`
- `.env.local` on all developer machines
- `.env.example` — verify it uses a placeholder, not the real value

**Related components:**
- All routes using `verifyCronAuth()`: cron route, markets route, admin routes

## Resources

- **Branch:** feat/creator-baseline-card
- **Review finding:** security-sentinel (P1)
- **Deleted file:** `scripts/poll-local.ps1` (contains the exposed value in git history)

## Acceptance Criteria

- [ ] New `CRON_SECRET` generated with `openssl rand -hex 32` (or equivalent)
- [ ] Vercel Production environment variable updated
- [ ] Vercel Preview environment variable updated
- [ ] Local `.env.local` updated
- [ ] `.env.example` confirmed to use a placeholder value
- [ ] Cron endpoint verified working with new secret via `bash scripts/poll-local.sh`
- [ ] Admin endpoints verified working with new secret

## Work Log

### 2026-04-13 - Code Review Discovery

**By:** Claude Code (ce-review)

**Actions:**
- Identified hardcoded credential in deleted poll-local.ps1
- Confirmed the value was committed to git history
- Confirmed replacement script (poll-local.sh) is safe
- Flagged rotation as mandatory P1 action
