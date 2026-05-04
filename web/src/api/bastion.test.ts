import { describe, expect, it } from "vitest";

import { buildBastionRequestActionPath, buildBastionRequestDecisionPath, buildBastionRequestsQuery } from "./bastion";

describe("buildBastionRequestsQuery", () => {
  it("builds the current user's request query", () => {
    expect(buildBastionRequestsQuery({ mine: true, limit: 50 })).toBe("mine=true&limit=50");
  });

  it("builds a pending approvals query", () => {
    expect(buildBastionRequestsQuery({ status: "pending", limit: 100 })).toBe("status=pending&limit=100");
  });

  it("keeps optional user and pagination filters explicit", () => {
    expect(buildBastionRequestsQuery({ userID: "user-1", offset: 25, limit: 25 })).toBe(
      "user_id=user-1&limit=25&offset=25",
    );
  });
});

describe("buildBastionRequestDecisionPath", () => {
  it("encodes request ids for decision endpoints", () => {
    expect(buildBastionRequestDecisionPath("request/1", "approve")).toBe(
      "/api/v1/bastion/requests/request%2F1/approve",
    );
  });
});

describe("buildBastionRequestActionPath", () => {
  it("builds cancel endpoints", () => {
    expect(buildBastionRequestActionPath("request 1", "cancel")).toBe(
      "/api/v1/bastion/requests/request%201/cancel",
    );
  });
});
