import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/config/db.js", () => ({
  supabase: null,
  supabaseAdmin: null,
}));

import supabaseHealth from "../../src/core/health/checks/supabaseHealth.js";

describe("supabaseHealth", () => {
  it("returns UNHEALTHY when no client is configured", async () => {
    const result = await supabaseHealth();

    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("not_configured");
  });
});
