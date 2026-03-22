---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, security]
dependencies: []
---

# Rotate All Exposed Credentials in .env.local.example

## Problem Statement

The file `.env.local.example` contains real, live production credentials for every service in the stack — database, Auth.js, Google OAuth, YouTube API, Resend email, and the cron endpoint. An example file is supposed to contain only placeholders. Anyone with filesystem access, a misconfigured deployment pipeline, or accidental push exposes all these secrets.

## Findings

- `.env.local.example` contains: real Neon DATABASE_URL, AUTH_SECRET (JWT signing key), AUTH_GOOGLE_ID/SECRET, YOUTUBE_API_KEY, RESEND_API_KEY, ADMIN_EMAIL, and CRON_SECRET
- `CRON_SECRET = "vasyakosmos12"` — a trivially guessable dictionary word
- The legitimate `env.example` (with placeholders) was deleted from the working tree
- A forged JWT using the exposed `AUTH_SECRET` would grant full authenticated access
- The exposed `CRON_SECRET` allows arbitrary triggering of market resolution

## Proposed Solutions

### Option 1: Rotate + Restore

**Approach:** Rotate every secret immediately, delete `.env.local.example`, restore `env.example` with placeholder-only values.

**Pros:** Correct fix; eliminates all exposure vectors
**Cons:** Requires touching 6+ external service consoles

**Effort:** 30 minutes
**Risk:** Low

---

### Option 2: Delete Only

**Approach:** Just delete `.env.local.example` without rotating.

**Pros:** Faster
**Cons:** If the file was ever shared or copied, secrets remain live — rotation is still required

**Effort:** 5 minutes
**Risk:** High (incomplete)

## Recommended Action

Implement Option 1. Rotate all credentials before any other work.

## Technical Details

**Affected files:**
- `.env.local.example` — delete after rotation
- `env.example` — restore with placeholders

**Services requiring secret rotation:**
- Neon PostgreSQL — generate new connection string
- Auth.js — generate new `AUTH_SECRET` via `npx auth secret`
- Google OAuth — generate new client ID/secret in Google Cloud Console
- YouTube Data API — rotate API key in Google Cloud Console
- Resend — rotate API key in Resend dashboard
- Cron secret — replace `vasyakosmos12` with a cryptographically random string (e.g., `openssl rand -hex 32`)

## Acceptance Criteria

- [ ] All credentials in `.env.local.example` have been rotated in their respective service consoles
- [ ] `.env.local.example` has been deleted from the working tree
- [ ] `env.example` has been restored with placeholder-only values documenting all required vars
- [ ] `.gitignore` confirms `.env*.local` is ignored
- [ ] No real secrets appear in any committed or tracked file

## Work Log

### 2026-03-22 - Discovery

**By:** Security Sentinel (code review agent)

**Actions:** Found real credentials in `.env.local.example` during security audit. Confirmed no secrets in git history via `git log`.
