import { describe, it, expect, vi } from "vitest";
import { Permission } from "../../src/core/auth/Permission.js";

describe("Permission", () => {
  it("rejects non-string action in constructor", () => {
    expect(() => new Permission({ action: 123 })).toThrow("non-empty action string");
    expect(() => new Permission({ action: "" })).toThrow("non-empty action string");
    expect(() => new Permission({ action: null })).toThrow("non-empty action string");
  });

  it("isRoleAllowed returns false for empty role", () => {
    const p = new Permission({ action: "order:create" });
    expect(p.isRoleAllowed("")).toBe(false);
    expect(p.isRoleAllowed(null)).toBe(false);
  });

  it("isRoleAllowed returns true for any role when roles list is empty", () => {
    const p = new Permission({ action: "order:create" });
    expect(p.isRoleAllowed("admin")).toBe(true);
    expect(p.isRoleAllowed("customer")).toBe(true);
  });

  it("isRoleAllowed respects the allowed roles list", () => {
    const p = new Permission({ action: "order:create", roles: ["admin"] });
    expect(p.isRoleAllowed("admin")).toBe(true);
    expect(p.isRoleAllowed("customer")).toBe(false);
  });

  it("checkOwnership returns true when no ownership function is set", () => {
    const p = new Permission({ action: "order:create" });
    expect(p.checkOwnership({ id: 1 }, { owner_id: 2 })).toBe(true);
  });

  it("checkOwnership calls ownership function when set", () => {
    const ownershipFn = vi.fn(() => true);
    const p = new Permission({ action: "order:create", ownership: ownershipFn });
    p.checkOwnership({ id: 1 }, { owner_id: 1 });
    expect(ownershipFn).toHaveBeenCalledWith({ id: 1 }, { owner_id: 1 });
  });

  it("toJSON produces correct shape", () => {
    const p = new Permission({ action: "order:create", roles: ["admin"], description: "Create orders" });
    const json = p.toJSON();
    expect(json.action).toBe("order:create");
    expect(json.roles).toEqual(["admin"]);
    expect(json.hasOwnershipCheck).toBe(false);
    expect(json.description).toBe("Create orders");
  });
});
