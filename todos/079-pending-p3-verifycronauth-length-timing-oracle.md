---
status: pending
priority: p3
issue_id: "079"
tags: [code-review, security, quality]
dependencies: []
---

# `verifyCronAuth` length pre-check creates a minor timing oracle that leaks CRON_SECRET length

## Problem Statement

```typescript
// src/lib/cron-auth.ts
if (
  authHeader.length !== expected.length ||
  !timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
)
```

The `||` short-circuit means requests with the wrong-length header return faster than requests with the correct length (which go through `timingSafeEqual`). This is a timing oracle leaking the byte-length of `"Bearer " + CRON_SECRET`. An attacker can binary-search the correct total length, then narrow the secret from `len("Bearer ") = 7` characters. This reduces the brute-force search space from all possible lengths to only the correct-length candidates.

In practice the impact is low given this is a low-volume admin API, but it is a known issue with the "length check before timing-safe compare" pattern.

## Proposed Solution

**Option A (Recommended):** HMAC both sides and compare fixed-length digests:
```typescript
import { createHmac } from "crypto";

const HMAC_KEY = "verifyCronAuth"; // constant key — just for length normalization
function hmac(s: string) {
  return createHmac("sha256", HMAC_KEY).update(s).digest();
}

if (!timingSafeEqual(hmac(authHeader), hmac(expected))) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

Both sides are always hashed to the same fixed 32-byte length before comparison. No length oracle.

**Option B:** Accept the current minor weakness — the practical risk is very low for an admin-only API with a random secret that rotates on deployment.

- **Effort**: Small
- **Risk**: Low

## Acceptance Criteria

- [ ] `verifyCronAuth` does not return early before the timing-safe comparison for any input length
- [ ] The comparison is still constant-time for all input lengths

## Work Log

- 2026-03-27: Identified during `/ce:review` — security-sentinel (P2-3, downgraded to P3)
