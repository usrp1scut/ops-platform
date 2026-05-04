import { describe, expect, it } from "vitest";

import { createPermissionChecker, hasPermission } from "./permissions";

describe("hasPermission", () => {
  it("allows system admin to pass any frontend permission hint", () => {
    expect(hasPermission(["system:admin"], "cmdb.asset:write")).toBe(true);
    expect(hasPermission(["system:admin"], "iam.user:read")).toBe(true);
  });

  it("matches explicit permissions and rejects missing permissions", () => {
    const can = createPermissionChecker(["cmdb.asset:read"]);

    expect(can("cmdb.asset:read")).toBe(true);
    expect(can("cmdb.asset:write")).toBe(false);
  });
});
