/**
 * DELETE /api/admin/markets/[id] tests — V3 (Slice C Phase 1).
 *
 * Hard-delete-or-cancel routing:
 *   - Clean draft (status='draft' AND zero trades/positions/snapshots) → physical DELETE.
 *   - Anything else → CAS-based cancel-instead (inlined V1 logic).
 *
 * Atomicity: SELECT FOR UPDATE serializes against concurrent trade inserts
 * so a trade landing mid-transaction can't sneak past the count check.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockExecute = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/db", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        select: mockSelect,
        update: mockUpdate,
        delete: mockDelete,
        execute: mockExecute,
      }),
    ),
  },
}));

vi.mock("@/lib/services/payout", () => ({
  refundPositions: vi.fn(),
}));

import { DELETE } from "../route";
import { refundPositions } from "@/lib/services/payout";

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_GATE = process.env.ADMIN_BEARER_LIFECYCLE_ENABLED;

function makeRequest(auth = "Bearer test-secret"): Request {
  return new Request("https://example.com/api/admin/markets/m1", {
    method: "DELETE",
    headers: { authorization: auth },
  });
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

// SELECT ... FOR UPDATE chain mock
function mockForUpdate(rows: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          for: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  });
}

// SELECT count(*) ... chain mock
function mockCountReturns(count: number) {
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ count }]),
    }),
  });
}

function mockUpdateReturns(rows: unknown[]) {
  mockUpdate.mockReturnValueOnce({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

function mockDeleteReturns(rows: unknown[]) {
  mockDelete.mockReturnValueOnce({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(rows),
    }),
  });
}

describe("DELETE /api/admin/markets/[id] — V3 hard-delete-or-cancel", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "test-secret";
    process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = "true";
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
    if (ORIGINAL_GATE === undefined) delete process.env.ADMIN_BEARER_LIFECYCLE_ENABLED;
    else process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = ORIGINAL_GATE;
    vi.restoreAllMocks();
  });

  it("hard-delete: clean draft with zero trades/positions/snapshots → physical DELETE, returns {deleted:true}", async () => {
    mockForUpdate([{ id: "m1", status: "draft" }]);
    mockCountReturns(0); // trades
    mockCountReturns(0); // positions
    mockCountReturns(0); // snapshots
    mockDeleteReturns([{ id: "m1" }]);

    const res = await DELETE(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, marketId: "m1", deleted: true });
    expect(refundPositions).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("cancel-instead (draft with trades): does NOT delete, CAS-cancels and refunds, returns {cancelled:true}", async () => {
    mockForUpdate([{ id: "m1", status: "draft" }]);
    mockCountReturns(1); // trades — triggers cancel-instead
    // No further count queries should fire — early exit.
    mockUpdateReturns([{ id: "m1" }]); // cancel CAS wins

    const res = await DELETE(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, marketId: "m1", cancelled: true });
    expect(refundPositions).toHaveBeenCalledWith(expect.anything(), "m1");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("cancel-instead (active market): CAS-cancels and refunds", async () => {
    mockForUpdate([{ id: "m1", status: "active" }]);
    mockUpdateReturns([{ id: "m1" }]);

    const res = await DELETE(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, marketId: "m1", cancelled: true });
    expect(refundPositions).toHaveBeenCalledWith(expect.anything(), "m1");
  });

  it("cancel-instead on resolved market → 422 from the cancel CAS", async () => {
    mockForUpdate([{ id: "m1", status: "resolved" }]);
    mockUpdateReturns([]); // CAS rejects non-cancellable statuses

    const res = await DELETE(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/cannot cancel|status/i);
    expect(refundPositions).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("404 when market not found", async () => {
    mockForUpdate([]);

    const res = await DELETE(makeRequest(), paramsFor("nope"));

    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("positions>0 forces cancel-instead even with 0 trades", async () => {
    mockForUpdate([{ id: "m1", status: "draft" }]);
    mockCountReturns(0); // trades
    mockCountReturns(1); // positions
    mockUpdateReturns([{ id: "m1" }]);

    const res = await DELETE(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    expect((await res.json()).cancelled).toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("snapshots>0 forces cancel-instead", async () => {
    mockForUpdate([{ id: "m1", status: "draft" }]);
    mockCountReturns(0); // trades
    mockCountReturns(0); // positions
    mockCountReturns(1); // snapshots
    mockUpdateReturns([{ id: "m1" }]);

    const res = await DELETE(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    expect((await res.json()).cancelled).toBe(true);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("503 when feature gate is off", async () => {
    process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = "false";

    const res = await DELETE(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(503);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("401 when auth is missing", async () => {
    const res = await DELETE(
      new Request("https://example.com/api/admin/markets/m1", {
        method: "DELETE",
      }),
      paramsFor("m1"),
    );
    expect(res.status).toBe(401);
  });
});
