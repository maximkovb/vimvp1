/**
 * POST /api/admin/markets/[id]/resolve-now tests — V2 (Slice C Phase 1).
 *
 * Novel behavior vs existing session-only `resolveNow` action:
 *   1. Bearer-gated (verifyCronAuth + env-flag gate).
 *   2. Outer CAS on prior status → 'resolving'. On 0 rows → 422.
 *   3. Compensating-CAS rollback on resolveMarket failure — market must
 *      return to its prior status on any oracle error (no-poll-data, DB fail, etc.).
 *   4. Cron-poll-vs-admin-click interleave: if virality's cron beats the admin
 *      click, the admin's outer CAS returns 0 rows and 422.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

const mockResolveMarket = vi.fn();
vi.mock("@/lib/oracle", () => ({
  resolveMarket: (...args: unknown[]) => mockResolveMarket(...args),
}));

import { POST } from "../route";

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_GATE = process.env.ADMIN_BEARER_LIFECYCLE_ENABLED;

function makeRequest(auth = "Bearer test-secret"): Request {
  return new Request("https://example.com/api/admin/markets/m1/resolve-now", {
    method: "POST",
    headers: { authorization: auth },
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// Helper — builds a chainable SELECT mock that resolves to `rows`.
function mockSelectReturns(rows: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

// Helper — builds a chainable UPDATE mock whose .returning() resolves to `rows`.
function mockUpdateReturns(rows: unknown[]) {
  mockUpdate.mockReturnValueOnce({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

describe("POST /api/admin/markets/[id]/resolve-now — V2", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = "true";
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_GATE === undefined) delete process.env.ADMIN_BEARER_LIFECYCLE_ENABLED;
    else process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = ORIGINAL_GATE;
    vi.restoreAllMocks();
  });

  it("happy path: active market resolves successfully", async () => {
    mockSelectReturns([{ id: "m1", status: "active" }]);
    mockUpdateReturns([{ id: "m1" }]); // outer CAS wins
    mockResolveMarket.mockResolvedValueOnce(undefined);

    const res = await POST(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, marketId: "m1" });
    expect(mockResolveMarket).toHaveBeenCalledWith("m1");
  });

  it("returns 404 when market does not exist", async () => {
    mockSelectReturns([]);

    const res = await POST(makeRequest(), paramsFor("nonexistent"));

    expect(res.status).toBe(404);
    expect(mockResolveMarket).not.toHaveBeenCalled();
  });

  it("returns 422 for resolved markets", async () => {
    mockSelectReturns([{ id: "m1", status: "resolved" }]);

    const res = await POST(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(422);
    expect(mockResolveMarket).not.toHaveBeenCalled();
  });

  it("returns 422 for cancelled markets", async () => {
    mockSelectReturns([{ id: "m1", status: "cancelled" }]);

    const res = await POST(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(422);
    expect(mockResolveMarket).not.toHaveBeenCalled();
  });

  it("returns 422 for markets already in 'resolving' state", async () => {
    mockSelectReturns([{ id: "m1", status: "resolving" }]);

    const res = await POST(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(422);
    expect(mockResolveMarket).not.toHaveBeenCalled();
  });

  it("cron-poll race: outer CAS returns 0 rows → 422, no resolveMarket call", async () => {
    // Initial SELECT shows active, but the cron-poll has already transitioned
    // to 'resolving' by the time our CAS fires — 0 rows updated.
    mockSelectReturns([{ id: "m1", status: "active" }]);
    mockUpdateReturns([]); // CAS loses

    const res = await POST(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/status changed|race|no longer/i);
    expect(mockResolveMarket).not.toHaveBeenCalled();
  });

  it("oracle failure (no poll data): compensating CAS restores prior status, rethrows error", async () => {
    mockSelectReturns([{ id: "m1", status: "active" }]);
    mockUpdateReturns([{ id: "m1" }]); // outer CAS wins
    mockResolveMarket.mockRejectedValueOnce(new Error("No poll data for market m1"));
    // Compensating UPDATE: should be called with status='active' (the prior status)
    // and guarded on current status='resolving' (only restore if nobody else moved on).
    mockUpdateReturns([{ id: "m1" }]);

    const res = await POST(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/no poll data/i);

    // Verify compensation was attempted. mockUpdate was called twice:
    // once for the outer CAS, once for compensation.
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("503 when ADMIN_BEARER_LIFECYCLE_ENABLED is not 'true'", async () => {
    process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = "false";

    const res = await POST(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Feature disabled" });
    // Gate runs after auth — so auth must pass first, but no DB work should happen.
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockResolveMarket).not.toHaveBeenCalled();
  });

  it("401 when auth header is missing", async () => {
    const res = await POST(
      new Request("https://example.com/api/admin/markets/m1/resolve-now", {
        method: "POST",
      }),
      paramsFor("m1"),
    );
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("401 when bearer token is wrong", async () => {
    const res = await POST(makeRequest("Bearer wrong"), paramsFor("m1"));
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
