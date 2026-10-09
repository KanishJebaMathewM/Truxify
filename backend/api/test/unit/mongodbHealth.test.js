import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/config/db.js", () => ({
  mongoDb: null,
}));

import mongodbHealth from "../../src/core/health/checks/mongodbHealth.js";

describe("mongodbHealth", () => {
  it("returns UNHEALTHY when mongoDb is not configured", async () => {
    const result = await mongodbHealth();
    expect(result.status).toBe("unhealthy");
    expect(result.message).toBe("not_configured");
  });
});
