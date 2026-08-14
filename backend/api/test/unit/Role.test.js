import { describe, it, expect } from "vitest";
import { ROLES, isValidRole, allRoles } from "../../src/core/auth/Role.js";

describe("Role", () => {
  it("ROLES contains customer, driver, and admin", () => {
    expect(ROLES.CUSTOMER).toBe("customer");
    expect(ROLES.DRIVER).toBe("driver");
    expect(ROLES.ADMIN).toBe("admin");
  });

  it("isValidRole returns true for known roles", () => {
    expect(isValidRole("customer")).toBe(true);
    expect(isValidRole("driver")).toBe(true);
    expect(isValidRole("admin")).toBe(true);
  });

  it("isValidRole returns false for unknown roles", () => {
    expect(isValidRole("superadmin")).toBe(false);
    expect(isValidRole("")).toBe(false);
    expect(isValidRole(null)).toBe(false);
    expect(isValidRole(undefined)).toBe(false);
    expect(isValidRole(123)).toBe(false);
  });

  it("allRoles returns all role strings", () => {
    const roles = allRoles();
    expect(roles).toContain("customer");
    expect(roles).toContain("driver");
    expect(roles).toContain("admin");
    expect(roles.length).toBe(3);
  });
});
