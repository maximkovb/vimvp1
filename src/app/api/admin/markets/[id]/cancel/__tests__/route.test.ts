/**
 * Cancel route tests — V1 CAS upgrade (Slice C Phase 1).
 *
 * The existing route relied on SELECT-then-UPDATE which let two concurrent
 * cancel calls both pass the non-cancellable check, both call refundPositions,
 * and the second insert into coin_transactions blew up with a 23505 unique
 * violation surfaced as a 5xx. V1 upgrades the status transition to a CAS
 * (UPDATE markets SET status='cancelled' WHERE id=$1 AND status IN (...)
 * RETURNING id) so the second caller gets a clean 422.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock db before importing the route so route.ts picks up the mock.
const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/db", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      // Inside the transaction callback, the tx has the same shape as db.
      return fn({
        select: mockSelect,
        update: mockUpdate,
        execute: mockExecute,
      });
    }),
  },
}));

vi.mock("@/lib/services/payout", () => ({
  refundPositions: vi.fn(),
}));

import { DELETE } from "../route";
import { refundPositions } from "@/lib/services/payout";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeRequest(auth = "Bearer test-secret"): Request {
  return new Request("https://example.com/api/admin/markets/m1/cancel", {
    method: "DELETE",
    headers: { authorization: auth },
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/admin/markets/[id]/cancel — V1 CAS upgrade", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("cancels an active market via CAS — returns 200", async () => {
    // CAS RETURNING succeeds with one row.
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "m1", status: "active" }]),
        }),
      }),
    });
    mockUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "m1" }]),
        }),
      }),
    });

    const res = await DELETE(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, marketId: "m1" });
    expect(refundPositions).toHaveBeenCalledWith(expect.anything(), "m1");
  });

  it("returns 422 when CAS loses — concurrent cancel already won, does NOT call refundPositions", async () => {
    // Existence check: market exists.
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "m1", status: "active" }]),
        }),
      }),
    });
    // CAS returns 0 rows — another caller already transitioned the status.
    mockUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await DELETE(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/cannot cancel|not cancellable|status/i);
    // Critical: refundPositions MUST NOT be called when the CAS lost.
    expect(refundPositions).not.toHaveBeenCalled();
  });

  it("returns 404 when market is not found", async () => {
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await DELETE(makeRequest(), paramsFor("nonexistent"));

    expect(res.status).toBe(404);
    expect(refundPositions).not.toHaveBeenCalled();
  });

  it("returns 422 for resolved markets (CAS excludes them from the IN clause)", async () => {
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: "m1", status: "resolved" }]),
        }),
      }),
    });
    mockUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const res = await DELETE(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(422);
    expect(refundPositions).not.toHaveBeenCalled();
  });

  it("returns 401 when auth header is missing", async () => {
    const res = await DELETE(
      new Request("https://example.com/api/admin/markets/m1/cancel", {
        method: "DELETE",
      }),
      paramsFor("m1"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when bearer token is wrong", async () => {
    const res = await DELETE(makeRequest("Bearer wrong"), paramsFor("m1"));
    expect(res.status).toBe(401);
  });
});
