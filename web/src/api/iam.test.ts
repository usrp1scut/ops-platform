import { describe, expect, it } from "vitest";

import {
  buildIamRolePermissionsPath,
  buildIamRolesQuery,
  buildIamUserPath,
  buildIamUserRolePath,
  buildIamUsersQuery,
} from "./iam";

describe("buildIamUsersQuery", () => {
  it("trims and encodes user search", () => {
    expect(buildIamUsersQuery({ query: " alice@example.com " })).toBe("q=alice%40example.com");
  });

  it("omits empty search", () => {
    expect(buildIamUsersQuery({ query: "   " })).toBe("");
  });
});

describe("buildIamRolesQuery", () => {
  it("requests role permissions explicitly", () => {
    expect(buildIamRolesQuery({ includePermissions: true })).toBe("include_permissions=true");
  });

  it("keeps the default role list compact", () => {
    expect(buildIamRolesQuery()).toBe("");
  });
});

describe("IAM endpoint builders", () => {
  it("encodes user ids for identity endpoints", () => {
    expect(buildIamUserPath("user/one")).toBe("/api/v1/iam/users/user%2Fone");
  });

  it("encodes role names for binding endpoints", () => {
    expect(buildIamUserRolePath("user one", "platform/admin")).toBe(
      "/api/v1/iam/users/user%20one/roles/platform%2Fadmin",
    );
  });

  it("encodes role names for permission endpoints", () => {
    expect(buildIamRolePermissionsPath("ops:admin")).toBe("/api/v1/iam/roles/ops%3Aadmin/permissions");
  });
});
