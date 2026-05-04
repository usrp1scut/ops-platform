import { describe, expect, it } from "vitest";

import { buildOIDCConfigPath, buildOIDCConfigTestPath } from "./oidc";

describe("OIDC endpoint builders", () => {
  it("builds the runtime config endpoint", () => {
    expect(buildOIDCConfigPath()).toBe("/api/v1/iam/oidc-config");
  });

  it("builds the connection test endpoint", () => {
    expect(buildOIDCConfigTestPath()).toBe("/api/v1/iam/oidc-config/test");
  });
});
