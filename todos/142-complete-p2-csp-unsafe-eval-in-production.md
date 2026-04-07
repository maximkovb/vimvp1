---
name: CSP includes unsafe-eval and unsafe-inline in production — defeats XSS protection
description: next.config.ts CSP script-src allows eval() and inline scripts in production, nullifying the policy against XSS
type: security
status: pending
priority: p2
issue_id: "142"
tags: [code-review, security, csp, xss]
dependencies: []
---

## Problem Statement

`next.config.ts` sets `script-src 'self' 'unsafe-inline' 'unsafe-eval'` unconditionally. `unsafe-eval` allows `eval()`, `new Function()`, and `setTimeout(string)` — completely defeating `script-src` XSS protection. `unsafe-inline` allows injected inline scripts. Together, these make the CSP `script-src` directive a no-op against XSS.

Note: `unsafe-eval` is needed in Next.js development but NOT in production builds (App Router, Next.js 13+).

## Findings

- **`src/next.config.ts:25`** (or similar): `"script-src 'self' 'unsafe-inline' 'unsafe-eval'"`

## Proposed Solutions

### Option A: Condition unsafe-eval on NODE_ENV (Quick win)
```ts
const scriptSrc = process.env.NODE_ENV === 'development'
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";
```
Removes `unsafe-eval` in production. Still has `unsafe-inline` but reduces surface.
- **Effort:** Tiny

### Option B: Use Next.js nonce-based CSP (Full fix)
Implement nonce injection via middleware for inline scripts, removing both `unsafe-inline` and `unsafe-eval` from production.
- **Effort:** Large — involves middleware + `generateBuildId` pattern

## Acceptance Criteria
- [ ] `unsafe-eval` not present in production CSP `script-src`
- [ ] Development still works with `unsafe-eval`

## Work Log
- 2026-04-06: Identified by security-sentinel during ce:review
