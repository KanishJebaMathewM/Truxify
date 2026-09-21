import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../../../src/middleware/logger.js", () => ({
  default: mockLogger,
}));

vi.mock("../../../../src/lib/redisLock.js", () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  LockAcquisitionError: class LockAcquisitionError extends Error {},
}));

vi.mock("../../../../src/config/db.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi
        .fn()
        .mockResolvedValue({
          data: { wallet_address: "0x123", kyc_verified: false },
          error: null,
        }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnThis(),
    })),
  },
  supabaseAdmin: null,
}));

vi.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: vi.fn(),
    Wallet: vi.fn(),
    Contract: vi.fn(),
  },
}));

import { acquireLock, releaseLock } from "../../../../src/lib/redisLock.js";

describe("ZKPService", () => {
  let zkpService;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.POLYGON_RPC_URL;
    delete process.env.PRIVATE_KEY;
    delete process.env.KYC_VERIFIER_CONTRACT;
    process.env.ZKP_MOCK = "true";
    process.env.NODE_ENV = "test";

    // Dynamically import to ensure fresh instance if needed, though module caching might keep it.
    // We import it here so it picks up the mocks.
    const module = await import("../../../../src/services/zkp/zkp.service.js");
    zkpService = module.default;
  });

  afterEach(() => {
    delete process.env.ZKP_MOCK;
    delete process.env.NODE_ENV;
  });

  // 1. Constructor gracefully disables the ZKP service when required environment variables are missing.
  it("disables itself when required env vars are missing", () => {
    expect(zkpService.contract).toBeNull();
    expect(zkpService.provider).toBeNull();
    expect(zkpService.wallet).toBeNull();
  });

  // 2. generateZKProof() returns the expected proof/publicSignals structure.
  it("generateZKProof() returns the expected proof/publicSignals structure", async () => {
    const driverData = {
      userId: "user-1",
      name: "Test User",
      licenseNumber: "DL-123",
      rcNumber: "RC-1",
      insuranceNumber: "POL-1",
      issueDate: "2020-01-01",
      expiryDate: "2030-01-01",
    };

    const result = await zkpService.generateZKProof(driverData);

    expect(result.success).toBe(true);
    expect(result.isMock).toBe(true);
    expect(result.proof).toBeDefined();
    expect(result.proof.a).toBeDefined();
    expect(result.proof.b).toBeDefined();
    expect(result.proof.c).toBeDefined();
    expect(result.publicSignals).toBeDefined();
    expect(result.documentHash).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });

  // 3. hashDocument() produces consistent hashes for the same document.
  it("hashDocument() produces consistent hashes for the same document", () => {
    const driverData = {
      name: "Test User",
      licenseNumber: "DL-123",
      rcNumber: "RC-1",
      insuranceNumber: "POL-1",
      issueDate: "2020-01-01",
      expiryDate: "2030-01-01",
    };
    const hash1 = zkpService.hashDocument(driverData);
    const hash2 = zkpService.hashDocument(driverData);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex digest
  });

  // 4. verifyKYC() / verifyDriver() acquires and releases the Redis lock correctly.
  it("verifyDriver() acquires and releases the Redis lock correctly", async () => {
    // Mock the acquireLock to succeed
    vi.mocked(acquireLock).mockResolvedValue("test-lock-value");
    vi.mocked(releaseLock).mockResolvedValue();

    // Mock internal dependencies so the rest of verifyDriver can proceed or fail safely without throwing unhandled exceptions
    vi.spyOn(zkpService, "isVerifiedInDb").mockResolvedValue(false);
    vi.spyOn(zkpService, "assertServerVerified").mockResolvedValue({
      ok: true,
    });
    vi.spyOn(zkpService, "generateZKProof").mockResolvedValue({ isMock: true });

    const driverData = { userId: "lock-test-user" };

    const result = await zkpService.verifyDriver(driverData);

    expect(acquireLock).toHaveBeenCalledWith(
      "zkp:verify:lock-test-user",
      expect.any(Number),
    );
    // Since it's a mock proof, it will return early with MOCK_PROOF_NOT_RECORDED, but should still release lock
    expect(result.success).toBe(false);
    expect(result.code).toBe("MOCK_PROOF_NOT_RECORDED");
    expect(releaseLock).toHaveBeenCalledWith(
      "zkp:verify:lock-test-user",
      "test-lock-value",
    );
  });

  // 5. Disabled-service behavior when required environment variables are unavailable.
  it("verifyKYCOnChain throws when service is disabled (missing env vars)", async () => {
    // The service is already disabled due to missing env vars in beforeEach
    const driverData = { userId: "user-1" };
    const proof = { a: [], b: [], c: [], input: [] };

    await expect(zkpService.verifyKYCOnChain("user-1", proof)).rejects.toThrow(
      "ZKPService not configured: missing environment variables",
    );
  });

  it("isVerified returns false when service is disabled", async () => {
    const result = await zkpService.isVerified("user-1");
    expect(result).toBe(false);
  });

  it("getDocumentHash returns null when service is disabled", async () => {
    const result = await zkpService.getDocumentHash("user-1");
    expect(result).toBeNull();
  });
  it("callSnarkJS returns a mock proof in test mode", async () => {
    const proofData = await zkpService.callSnarkJS({ name: "A" }, "0xhash");
    expect(proofData.isMock).toBe(true);
    expect(proofData.proof.a).toBeDefined();
    expect(proofData.publicSignals).toContain("0xhash");
  });

  it("callSnarkJS throws when mock proofs are attempted in production", async () => {
    process.env.ZKP_MOCK = "true";
    process.env.NODE_ENV = "production";
    await expect(
      zkpService.callSnarkJS({ name: "A" }, "0xhash")
    ).rejects.toThrow(/disallowed in production/);
    delete process.env.NODE_ENV;
  });

  it("callSnarkJS still mocks in test mode even when ZKP_MOCK is false", async () => {
    process.env.ZKP_MOCK = "false";
    const proofData = await zkpService.callSnarkJS({ name: "A" }, "0xhash");
    expect(proofData.isMock).toBe(true);
  });
});
