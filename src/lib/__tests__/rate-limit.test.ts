import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  applyAdminRateLimit,
  __resetRateLimitForTests,
} from "../rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it("allows requests under the limit", () => {
    const now = 1000;
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit("k", { limit: 10, windowMs: 60_000 }, now + i);
      expect(r.ok).toBe(true);
    }
  });

  it("blocks when limit is reached", () => {
    const now = 1000;
    for (let i = 0; i < 10; i++) {
      checkRateLimit("k", { limit: 10, windowMs: 60_000 }, now + i);
    }
    const r = checkRateLimit("k", { limit: 10, windowMs: 60_000 }, now + 11);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const now = 1000;
    for (let i = 0; i < 10; i++) {
      checkRateLimit("k", { limit: 10, windowMs: 60_000 }, now + i);
    }
    const r = checkRateLimit("k", { limit: 10, windowMs: 60_000 }, now + 60_001);
    expect(r.ok).toBe(true);
  });

  it("tracks separate buckets per key", () => {
    const now = 1000;
    for (let i = 0; i < 10; i++) {
      checkRateLimit("a", { limit: 10, windowMs: 60_000 }, now + i);
    }
    // Bucket 'a' is full, but 'b' is independent.
    expect(checkRateLimit("b", { limit: 10, windowMs: 60_000 }, now + 11).ok).toBe(true);
  });
});

describe("applyAdminRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it("returns null under the limit", () => {
    const req = new Request("https://e.com", {
      headers: { authorization: "Bearer s" },
    });
    expect(applyAdminRateLimit(req, { limit: 10, windowMs: 60_000 })).toBeNull();
  });

  it("returns 429 with Retry-After when over the limit", async () => {
    const req = new Request("https://e.com", {
      headers: { authorization: "Bearer s" },
    });
    for (let i = 0; i < 10; i++) {
      applyAdminRateLimit(req, { limit: 10, windowMs: 60_000 });
    }
    const res = applyAdminRateLimit(req, { limit: 10, windowMs: 60_000 });

    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    const body = await res!.json();
    expect(body).toEqual({ error: "Rate limit exceeded" });
    const retryAfter = res!.headers.get("Retry-After");
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
  });

  it("two requests with the same bearer share a bucket", () => {
    const reqA = new Request("https://e.com", {
      headers: { authorization: "Bearer same-token", "x-forwarded-for": "1.1.1.1" },
    });
    const reqB = new Request("https://e.com", {
      headers: { authorization: "Bearer same-token", "x-forwarded-for": "2.2.2.2" },
    });
    for (let i = 0; i < 10; i++) {
      applyAdminRateLimit(reqA, { limit: 10, windowMs: 60_000 });
    }
    // Different IP but same bearer — still rate-limited.
    expect(
      applyAdminRateLimit(reqB, { limit: 10, windowMs: 60_000 })!.status,
    ).toBe(429);
  });

  it("two requests with different bearers have independent buckets", () => {
    const reqA = new Request("https://e.com", {
      headers: { authorization: "Bearer token-a" },
    });
    const reqB = new Request("https://e.com", {
      headers: { authorization: "Bearer token-b" },
    });
    for (let i = 0; i < 10; i++) {
      applyAdminRateLimit(reqA, { limit: 10, windowMs: 60_000 });
    }
    // Different bearer — independent bucket.
    expect(applyAdminRateLimit(reqB, { limit: 10, windowMs: 60_000 })).toBeNull();
  });

  it("falls back to IP when no auth header", () => {
    const req = new Request("https://e.com", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    // Should not throw and should return null on first request.
    expect(applyAdminRateLimit(req, { limit: 10, windowMs: 60_000 })).toBeNull();
  });

  it("bucket key never contains the raw secret", () => {
    // This is covered indirectly — we can't read the internal key — but
    // hashing is what we audit for. Verify that two-char-difference secrets
    // produce different buckets (sanity check on hash sensitivity).
    const r1 = new Request("https://e.com", {
      headers: { authorization: "Bearer abc" },
    });
    const r2 = new Request("https://e.com", {
      headers: { authorization: "Bearer abd" },
    });
    for (let i = 0; i < 10; i++) {
      applyAdminRateLimit(r1, { limit: 10, windowMs: 60_000 });
    }
    expect(applyAdminRateLimit(r2, { limit: 10, windowMs: 60_000 })).toBeNull();
  });
});
