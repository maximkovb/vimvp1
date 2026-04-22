import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyCronAuth } from "../cron-auth";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

describe("verifyCronAuth", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_SECRET;
    }
    vi.restoreAllMocks();
  });

  it("returns 401 (not 500) when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const req = new Request("https://example.com", {
      headers: { authorization: "Bearer anything" },
    });

    const response = verifyCronAuth(req);

    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
    const body = await response!.json();
    expect(body).toEqual({ error: "unauthorized" });
    // Operator visibility — log the misconfiguration server-side.
    expect(console.error).toHaveBeenCalledWith(
      "[cron-auth] CRON_SECRET not configured",
    );
  });

  it("does not leak the string 'CRON_SECRET not configured' in the response body", async () => {
    delete process.env.CRON_SECRET;
    const req = new Request("https://example.com", {
      headers: { authorization: "Bearer x" },
    });

    const response = verifyCronAuth(req);
    const body = await response!.text();

    expect(body).not.toContain("CRON_SECRET");
    expect(body).not.toContain("not configured");
  });

  it("returns null when secret is configured and header matches", () => {
    process.env.CRON_SECRET = "test-secret-value";
    const req = new Request("https://example.com", {
      headers: { authorization: "Bearer test-secret-value" },
    });

    expect(verifyCronAuth(req)).toBeNull();
  });

  it("returns 401 when secret is configured but header is missing", async () => {
    process.env.CRON_SECRET = "test-secret-value";
    const req = new Request("https://example.com");

    const response = verifyCronAuth(req);

    expect(response!.status).toBe(401);
    expect(await response!.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when secret is configured but header is wrong", async () => {
    process.env.CRON_SECRET = "test-secret-value";
    const req = new Request("https://example.com", {
      headers: { authorization: "Bearer wrong-secret" },
    });

    const response = verifyCronAuth(req);

    expect(response!.status).toBe(401);
  });
});
