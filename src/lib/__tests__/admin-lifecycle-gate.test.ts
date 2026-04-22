import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { requireAdminLifecycleEnabled } from "../admin-lifecycle-gate";

const ORIGINAL = process.env.ADMIN_BEARER_LIFECYCLE_ENABLED;

describe("requireAdminLifecycleEnabled", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.ADMIN_BEARER_LIFECYCLE_ENABLED;
    else process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = ORIGINAL;
    vi.restoreAllMocks();
  });

  it("returns 503 when env var is unset", async () => {
    delete process.env.ADMIN_BEARER_LIFECYCLE_ENABLED;
    const res = requireAdminLifecycleEnabled();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    const body = await res!.json();
    expect(body).toEqual({ error: "Feature disabled" });
    expect(console.warn).toHaveBeenCalledWith("[admin-lifecycle] route gated off");
  });

  it("returns 503 when env var is 'false'", () => {
    process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = "false";
    const res = requireAdminLifecycleEnabled();
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
  });

  it("returns 503 when env var is any non-'true' value", () => {
    process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = "yes";
    expect(requireAdminLifecycleEnabled()!.status).toBe(503);

    process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = "1";
    expect(requireAdminLifecycleEnabled()!.status).toBe(503);

    process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = "TRUE";
    expect(requireAdminLifecycleEnabled()!.status).toBe(503);
  });

  it("returns null when env var is exactly 'true'", () => {
    process.env.ADMIN_BEARER_LIFECYCLE_ENABLED = "true";
    expect(requireAdminLifecycleEnabled()).toBeNull();
  });
});
