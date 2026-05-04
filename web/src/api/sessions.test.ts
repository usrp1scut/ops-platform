import { describe, expect, it } from "vitest";

import {
  buildAssetRdpTicketPath,
  buildAssetTerminalTicketPath,
  buildSessionRecordingPath,
  buildSessionsQuery,
} from "./sessions";

describe("buildSessionsQuery", () => {
  it("serializes list filters", () => {
    expect(buildSessionsQuery({ assetID: "asset-1", limit: 50, offset: 10, userID: "user-1" })).toBe(
      "user_id=user-1&asset_id=asset-1&limit=50&offset=10",
    );
  });

  it("omits empty filters", () => {
    expect(buildSessionsQuery({ limit: 100 })).toBe("limit=100");
  });
});

describe("session endpoint builders", () => {
  it("encodes recording paths", () => {
    expect(buildSessionRecordingPath("session/one")).toBe("/api/v1/cmdb/sessions/session%2Fone/recording");
  });

  it("encodes ticket paths", () => {
    expect(buildAssetTerminalTicketPath("asset/one")).toBe(
      "/api/v1/cmdb/assets/asset%2Fone/terminal/ticket",
    );
    expect(buildAssetRdpTicketPath("asset one")).toBe("/api/v1/cmdb/assets/asset%20one/rdp/ticket");
  });
});
