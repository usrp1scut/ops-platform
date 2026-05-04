import { describe, expect, it } from "vitest";

import { buildAwsAccountPath, buildAwsAccountTestPath, buildAwsSyncRunsQuery } from "./aws";

describe("AWS endpoint builders", () => {
  it("encodes account row ids for detail endpoints", () => {
    expect(buildAwsAccountPath("acct/one")).toBe("/api/v1/aws/accounts/acct%2Fone");
  });

  it("builds account connection test endpoints", () => {
    expect(buildAwsAccountTestPath("acct one")).toBe("/api/v1/aws/accounts/acct%20one/test");
  });
});

describe("buildAwsSyncRunsQuery", () => {
  it("keeps the explicit limit parameter", () => {
    expect(buildAwsSyncRunsQuery({ limit: 120 })).toBe("limit=120");
  });

  it("omits missing options", () => {
    expect(buildAwsSyncRunsQuery()).toBe("");
  });
});
