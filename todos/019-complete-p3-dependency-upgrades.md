---
status: pending
priority: p3
issue_id: "019"
tags: [code-review, security, dependencies]
dependencies: []
---

# Upgrade Auth.js from Beta and Resolve esbuild Vulnerability

## Problem Statement

Two dependency issues: (1) `next-auth@^5.0.0-beta.30` is pre-release software in production — the stable v5 has since released; (2) `drizzle-kit` has a transitive dependency on `esbuild <= 0.24.2` which has a moderate CORS vulnerability (GHSA-67mh-4wv8-2f99) affecting the development server.

## Findings

- `package.json`: `"next-auth": "^5.0.0-beta.30"` — beta version, may contain undisclosed security issues and has breaking changes in patch releases; stable v5 released
- `npm audit`: `esbuild <=0.24.2` — GHSA-67mh-4wv8-2f99, moderate severity; dev server allows arbitrary cross-origin requests; affects `drizzle-kit` tooling during local development
- esbuild vulnerability is dev-time only (not in production builds) but affects any developer running `drizzle-kit` locally with a malicious browser tab open

## Proposed Solutions

### Option 1: Upgrade Both

1. Upgrade `next-auth` to stable: `npm install next-auth@latest`
2. Upgrade `drizzle-kit` to a version that ships `esbuild >= 0.25.0`: `npm install drizzle-kit@latest --save-dev`

Test auth flows after upgrading (OAuth redirect, credentials login, session persistence) as Auth.js v5 stable may have minor API differences from beta.30.

**Effort:** 2-3 hours (including testing) | **Risk:** Medium (auth upgrade requires testing)

---

### Option 2: Lock esbuild Version

**Approach:** Add an `overrides` or `resolutions` field in `package.json` to force `esbuild >= 0.25.0`.

**Pros:** Quick fix for the vulnerability without a full drizzle-kit upgrade
**Cons:** Doesn't address the Auth.js beta issue

**Effort:** 15 minutes | **Risk:** Low

## Recommended Action

Option 1. Both upgrades are worthwhile; do them together with a test pass on auth flows.

## Technical Details

**Affected files:**
- `package.json` — update next-auth and drizzle-kit versions
- `package-lock.json` — regenerate after upgrade

**Test checklist after auth upgrade:**
- [ ] Google OAuth sign-in flow works
- [ ] Credentials sign-in works
- [ ] Session persists across page navigations
- [ ] JWT callback populates `session.user.id` correctly
- [ ] Admin email check still works

## Acceptance Criteria

- [ ] `next-auth` is on a stable v5 release (not beta)
- [ ] `npm audit` shows no moderate+ vulnerabilities
- [ ] All auth flows work as before after upgrade
- [ ] Drizzle migrations still work with updated drizzle-kit

## Work Log

### 2026-03-22 - Discovery

**By:** Security sentinel (code review)
