import { describe, it, expect } from "vitest";
import { AuthorizationError } from "../../src/core/auth/AuthorizationError.js";

describe("AuthorizationError", () => {
  it("creates error with 401 and infers UNAUTHENTICATED code", () => {
    const err = new AuthorizationError(401, "Not authenticated");
    expect(err.status).toBe(401);
    expect(err.errorCode).toBe("UNAUTHENTICATED");
    expect(err.message).toBe("Not authenticated");
  });

  it("creates error with 403 and infers FORBIDDEN code", () => {
    const err = new AuthorizationError(403, "Not allowed");
    expect(err.status).toBe(403);
    expect(err.errorCode).toBe("FORBIDDEN");
  });

  it("creates error with arbitrary status and uses default code", () => {
    const err = new AuthorizationError(500, "Server error");
    expect(err.status).toBe(500);
    expect(err.errorCode).toBe("AUTHORIZATION_ERROR");
  });

  it("accepts a custom error code", () => {
    const err = new AuthorizationError(403, "Custom", "CUSTOM_CODE");
    expect(err.errorCode).toBe("CUSTOM_CODE");
  });

  it("toJSON produces correct shape", () => {
    const err = new AuthorizationError(403, "Forbidden", "ROLE_DENIED");
    const json = err.toJSON();
    expect(json.error).toBe("Forbidden");
    expect(json.errorCode).toBe("ROLE_DENIED");
    expect(json.status).toBe(403);
  });
});
