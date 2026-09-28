import { jest } from "@jest/globals";

// Mock rateLimiter module including nearbyLimiter along with userLimiter
jest.unstable_mockModule("../../src/middleware/rateLimiter.js", () => ({
  userLimiter: (req, res, next) => next(),
  nearbyLimiter: (req, res, next) => next(),
  safeIpKeyGenerator: (req) => req.ip || "127.0.0.1",
  userKeyGenerator: (req) => req.user?.id || "unknown",
  createStore: () => ({}),
}));

// Mock db module including getAdminClient along with other exports
jest.unstable_mockModule("../../src/config/db.js", () => ({
  getAdminClient: jest.fn(() => ({
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: {}, error: null }),
  })),
  redisClient: {
    status: "ready",
    call: jest.fn(),
  },
}));

describe("Admin Routes Unit Tests", () => {
  it("should load admin routes cleanly without missing mock export errors", async () => {
    // Import module dynamically after register mocks
    const adminRoutes = await import("../../src/routes/adminRoutes.js");
    expect(adminRoutes).toBeDefined();
  });
});
