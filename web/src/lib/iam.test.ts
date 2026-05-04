import { describe, expect, it } from "vitest";

import { groupRolePermissions, iamUserLabel, rolesAvailableToBind } from "./iam";

describe("iamUserLabel", () => {
  it("prefers name, then email, then subject, then id", () => {
    expect(iamUserLabel({ id: "u1", oidc_subject: "sub", email: "a@example.com", name: "Alice", created_at: "", updated_at: "", last_login_at: "" })).toBe("Alice");
    expect(iamUserLabel({ id: "u1", oidc_subject: "sub", email: "a@example.com", created_at: "", updated_at: "", last_login_at: "" })).toBe("a@example.com");
    expect(iamUserLabel({ id: "u1", oidc_subject: "sub", created_at: "", updated_at: "", last_login_at: "" })).toBe("sub");
  });
});

describe("rolesAvailableToBind", () => {
  it("removes roles already assigned to the selected user", () => {
    expect(
      rolesAvailableToBind(
        [
          { id: "r1", name: "admin", description: "", created_at: "" },
          { id: "r2", name: "reader", description: "", created_at: "" },
        ],
        ["admin"],
      ).map((role) => role.name),
    ).toEqual(["reader"]);
  });
});

describe("groupRolePermissions", () => {
  it("groups permissions by resource and sorts stable output", () => {
    expect(
      groupRolePermissions([
        { resource: "iam.user", action: "write", permission: "iam.user:write" },
        { resource: "cmdb.asset", action: "read", permission: "cmdb.asset:read" },
        { resource: "iam.user", action: "read", permission: "iam.user:read" },
      ]),
    ).toEqual([
      {
        actions: ["read"],
        permissions: ["cmdb.asset:read"],
        resource: "cmdb.asset",
      },
      {
        actions: ["read", "write"],
        permissions: ["iam.user:read", "iam.user:write"],
        resource: "iam.user",
      },
    ]);
  });
});
