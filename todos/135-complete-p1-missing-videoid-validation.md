---
status: pending
priority: p1
issue_id: "135"
tags: [code-review, security, validation]
dependencies: []
---

# Security: Add VideoId Validation to Public Play-URL Endpoint

## Problem Statement

The public endpoint `GET /api/tiktok/[videoId]/play-url` accepts a dynamic `videoId` parameter but performs **zero validation** before passing it to the TikWM API. This creates three security/operational gaps:

1. **Unguarded external API calls** — Attackers can enumerate arbitrary videoIds, forcing unintended TikWM API requests and potentially exhausting rate limits or quotas
2. **Inconsistent security posture** — The cron polling (`poll-tiktok/route.ts:113`) and admin market creation (`admin.ts:184`) both validate playUrl against `TIKTOK_PLAY_URL_RE`, but the public endpoint doesn't validate inputs
3. **Information leakage via timing/error responses** — Different error types (404 for missing video, 502 for API failure) can be used to probe for valid videoIds

## Findings

**From:** architecture-strategist, security-sentinel  
**Source:** `/src/app/api/tiktok/[videoId]/play-url/route.ts`

### Current Vulnerability
```typescript
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  
  let stats;
  try {
    stats = await fetchTikTokStatsById(videoId);  // ← No validation before TikWM call
  } catch {
    return NextResponse.json({ error: "Failed to fetch video" }, { status: 502 });
  }
  // ...
}
```

### Why It Matters
- **TikWM rate limiting**: Each invalid videoId triggers a TikWM API call (~0.5s latency). Attacker can DOS TikWM or exhaust quota.
- **Enumeration attacks**: Attacker probes `[0-9]{15,20}` videoIds to find valid TikTok videos
- **Architectural inconsistency**: All other surfaces validate against `TIKTOK_VIDEO_ID_RE`, but this endpoint doesn't

## Proposed Solutions

### Solution 1: Add Regex Validation Before TikWM Call (Recommended)
**Approach:** Validate videoId matches `TIKTOK_VIDEO_ID_RE` pattern before calling external API.

**Pros:**
- Minimal code change (2–3 lines)
- Blocks invalid IDs at the boundary
- Prevents enumeration and unguarded API calls
- Consistent with cron + admin validation

**Cons:**
- None — this is a best practice

**Effort:** SMALL (2 minutes)

**Risk:** NONE

---

### Solution 2: Rate Limit the Endpoint
**Approach:** Add rate limiting via Next.js middleware or Vercel rate-limit header.

**Pros:**
- Protects against enumeration DOS

**Cons:**
- Doesn't prevent the first invalid call per IP/user
- Requires middleware setup
- Orthogonal to input validation

**Effort:** MEDIUM (15 minutes)

**Risk:** Could block legitimate clients if limit is too strict

---

## Recommended Action

**Implement Solution 1** — Add regex validation. This is a required security fix.

## Acceptance Criteria

- [ ] `videoId` parameter is validated against `TIKTOK_VIDEO_ID_RE` before any external API call
- [ ] Invalid videoIds return `400 Bad Request` with clear error message
- [ ] Valid videoIds that don't exist return `404 Not Found` (graceful failure)
- [ ] No unvalidated videoId reaches `fetchTikTokStatsById()`
- [ ] Validation matches the pattern used in `constants.ts` (no duplication)

## Technical Details

**File:** `/src/app/api/tiktok/[videoId]/play-url/route.ts`

**Import required:**
```typescript
import { TIKTOK_VIDEO_ID_RE } from "@/lib/constants";
```

**Implementation:**
```typescript
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;
  
  // NEW: Validate format before calling external API
  if (!TIKTOK_VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json(
      { error: "Invalid video ID format" }, 
      { status: 400 }
    );
  }
  
  let stats;
  try {
    stats = await fetchTikTokStatsById(videoId);
  } catch {
    return NextResponse.json({ error: "Failed to fetch video" }, { status: 502 });
  }
  
  if (!stats?.playUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  
  return NextResponse.json({ playUrl: stats.playUrl });
}
```

**Related:** This endpoint should also validate the returned `playUrl` (see todo #136).

## Work Log

- **2026-04-12 00:00** — Created todo from architecture-strategist findings
- **Status:** Waiting for implementation

## Resources

- **Architecture Review:** `architecture-strategist` findings #1, #2
- **Security Review:** `security-sentinel` confirmed no CRITICAL issues but flagged this as MINOR #1
- **Constant definition:** `/src/lib/constants.ts` line 13
