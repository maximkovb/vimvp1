/**
 * GET /api/admin/markets/[id]/delete-preview tests — V4 (Slice C Phase 1).
 *
 * Read-only pre-check for the clipmarket admin UI's Delete button.
 * Returns { branch, status } only — NO raw counts (resolves the security
 * finding that exposed counts could be used to enumerate market activity).
 *
 * Branches:
 *   - 'hard-delete' iff status='draft' AND all counts = 0
 *   - 'terminal-reject' iff status in {resolved, cancelled}
 *   - 'cancel-instead' otherwise
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockSelect = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

import { GET } from "../route";

const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_GATE = process.env.ADMIN_BEARER_LIFECYCLE_ENABLED;

function makeRequest(auth = "Bearer test-secret"): Request {
  return new Request(
    "https://example.com/api/admin/markets/m1/delete-preview",
    { headers: { authorization: auth } },
  );
}

function paramsFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function mockMarketSelect(rows: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

function mockCountSelect(count: number) {
  mockSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ count }]),
    }),
  });
}

describe("GET /api/admin/markets/[id]/delete-preview — V4", () => {
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

  it("hard-delete: clean draft with zero trades/positions/snapshots", async () => {
    mockMarketSelect([{ id: "m1", status: "draft" }]);
    mockCountSelect(0);
    mockCountSelect(0);
    mockCountSelect(0);

    const res = await GET(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ branch: "hard-delete", status: "draft" });
    // Security — raw counts MUST NOT appear in the response body.
    expect(body).not.toHaveProperty("counts");
    expect(body).not.toHaveProperty("trades");
    expect(body).not.toHaveProperty("positions");
  });

  it("cancel-instead: draft with trades", async () => {
    mockMarketSelect([{ id: "m1", status: "draft" }]);
    mockCountSelect(1);

    const res = await GET(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ branch: "cancel-instead", status: "draft" });
  });

  it("cancel-instead: active market", async () => {
    mockMarketSelect([{ id: "m1", status: "active" }]);

    const res = await GET(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ branch: "cancel-instead", status: "active" });
  });

  it("cancel-instead: halted market", async () => {
    mockMarketSelect([{ id: "m1", status: "halted" }]);

    const res = await GET(makeRequest(), paramsFor("m1"));

    const body = await res.json();
    expect(body.branch).toBe("cancel-instead");
  });

  it("terminal-reject: resolved market", async () => {
    mockMarketSelect([{ id: "m1", status: "resolved" }]);

    const res = await GET(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ branch: "terminal-reject", status: "resolved" });
  });

  it("terminal-reject: cancelled market", async () => {
    mockMarketSelect([{ id: "m1", status: "cancelled" }]);

    const res = await GET(makeRequest(), paramsFor("m1"));

    const body = await res.json();
    expect(body).toEqual({ branch: "terminal-reject", status: "cancelled" });
  });

  it("404 when market not found", async () => {
    mockMarketSelect([]);

    const res = await GET(makeRequest(), paramsFor("nope"));

    expect(res.status).toBe(404);
  });

  it("503 when gate is off", async () => {
    process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = "false";

    const res = await GET(makeRequest(), paramsFor("m1"));

    expect(res.status).toBe(503);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("401 when auth is missing", async () => {
    const res = await GET(
      new Request("https://example.com/api/admin/markets/m1/delete-preview"),
      paramsFor("m1"),
    );
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
