import { describe, expect, it } from "vitest";

import {
  buildAssetConnectionPath,
  buildAssetConnectionTestPath,
  buildAssetPath,
  buildAssetProbePath,
  buildAssetProbeRunPath,
  buildAssetRelationDeletePath,
  buildAssetRelationsPath,
  buildAssetVPCProxyDemotePath,
  buildAssetVPCProxyPromotePath,
  buildAssetsQuery,
} from "./cmdb";

describe("buildAssetsQuery", () => {
  it("builds a simple active asset search query", () => {
    expect(buildAssetsQuery({ query: "db", status: "active", limit: 20 })).toBe("status=active&q=db&limit=20");
  });

  it("keeps filters in a stable backend-friendly order", () => {
    expect(
      buildAssetsQuery({
        accountID: "123456789012",
        criticality: "high",
        env: "prod",
        isVPCProxy: false,
        offset: 40,
        owner: "platform",
        region: "us-east-1",
        source: "aws",
        type: "ec2",
      }),
    ).toBe(
      "type=ec2&env=prod&source=aws&region=us-east-1&account_id=123456789012&owner=platform&criticality=high&is_vpc_proxy=false&offset=40",
    );
  });
});

describe("buildAssetPath", () => {
  it("encodes asset ids for detail endpoints", () => {
    expect(buildAssetPath("asset/one")).toBe("/api/v1/cmdb/assets/asset%2Fone");
  });
});

describe("buildAssetConnectionPath", () => {
  it("builds connection profile endpoints from encoded asset ids", () => {
    expect(buildAssetConnectionPath("asset one")).toBe("/api/v1/cmdb/assets/asset%20one/connection");
  });
});

describe("buildAssetConnectionTestPath", () => {
  it("builds connection test endpoints from encoded asset ids", () => {
    expect(buildAssetConnectionTestPath("asset/one")).toBe("/api/v1/cmdb/assets/asset%2Fone/connection/test");
  });
});

describe("buildAssetProbePath", () => {
  it("builds latest probe endpoints from encoded asset ids", () => {
    expect(buildAssetProbePath("asset:one")).toBe("/api/v1/cmdb/assets/asset%3Aone/probe/latest");
  });
});

describe("buildAssetRelationsPath", () => {
  it("builds relation endpoints from encoded asset ids", () => {
    expect(buildAssetRelationsPath("asset?one")).toBe("/api/v1/cmdb/assets/asset%3Fone/relations");
  });
});

describe("buildAssetRelationDeletePath", () => {
  it("encodes both asset and relation ids", () => {
    expect(buildAssetRelationDeletePath("asset/one", "rel two")).toBe(
      "/api/v1/cmdb/assets/asset%2Fone/relations/rel%20two",
    );
  });
});

describe("buildAssetProbeRunPath", () => {
  it("builds probe-run endpoints from encoded asset ids", () => {
    expect(buildAssetProbeRunPath("asset/one")).toBe("/api/v1/cmdb/assets/asset%2Fone/probe/run");
  });
});

describe("buildAssetVPCProxyPromotePath", () => {
  it("builds promote endpoints from encoded asset ids", () => {
    expect(buildAssetVPCProxyPromotePath("asset one")).toBe(
      "/api/v1/cmdb/assets/asset%20one/promote-vpc-proxy",
    );
  });
});

describe("buildAssetVPCProxyDemotePath", () => {
  it("builds demote endpoints from encoded asset ids", () => {
    expect(buildAssetVPCProxyDemotePath("asset:one")).toBe(
      "/api/v1/cmdb/assets/asset%3Aone/demote-vpc-proxy",
    );
  });
});
