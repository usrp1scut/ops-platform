import { describe, expect, it } from "vitest";

import type { Asset } from "../api/cmdb";
import {
  buildAssetTree,
  buildLaunchSearch,
  filterConnectableAssets,
  isConnectableAsset,
  parseLaunchParams,
} from "./launch";

function makeAsset(overrides: Partial<Asset>): Asset {
  return {
    created_at: "2026-01-01T00:00:00Z",
    env: "default",
    id: overrides.id || "asset-x",
    name: overrides.name || overrides.id || "asset-x",
    source: "manual",
    status: "active",
    type: "ec2",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

describe("isConnectableAsset", () => {
  it.each([
    "ec2",
    "rds_instance",
    "host",
    "EC2_INSTANCE",
  ])("treats %s as connectable", (type) => {
    expect(isConnectableAsset(makeAsset({ id: type, type }))).toBe(true);
  });

  it.each([
    "aws_vpc",
    "vpc",
    "aws_security_group",
    "security_group",
    "aws_iam_user",
    "alb",
    "aws_s3_bucket",
  ])("filters out %s", (type) => {
    expect(isConnectableAsset(makeAsset({ id: type, type }))).toBe(false);
  });

  it("rejects null input", () => {
    expect(isConnectableAsset(null)).toBe(false);
    expect(isConnectableAsset(undefined)).toBe(false);
  });
});

describe("buildAssetTree", () => {
  it("groups assets by env then vpc and splits bastions from members", () => {
    const assets = [
      makeAsset({ id: "a-prod-vpc1-host1", env: "prod", vpc_id: "vpc-1" }),
      makeAsset({ id: "a-prod-vpc1-bastion", env: "prod", vpc_id: "vpc-1", is_vpc_proxy: true }),
      makeAsset({ id: "a-prod-vpc2-host1", env: "prod", vpc_id: "vpc-2" }),
      makeAsset({ id: "a-staging", env: "staging", vpc_id: undefined }),
      makeAsset({ id: "a-default", env: undefined, vpc_id: undefined }),
    ];
    const tree = buildAssetTree(assets);

    // env order is alphabetical
    expect(tree.map((env) => env.envName)).toEqual(["default", "prod", "staging"]);

    const prod = tree.find((env) => env.envName === "prod");
    expect(prod?.total).toBe(3);
    expect(prod?.vpcs.map((vpc) => vpc.vpcKey)).toEqual(["vpc-1", "vpc-2"]);
    expect(prod?.vpcs[0].bastions.map((a) => a.id)).toEqual(["a-prod-vpc1-bastion"]);
    expect(prod?.vpcs[0].members.map((a) => a.id)).toEqual(["a-prod-vpc1-host1"]);

    // assets without vpc collapse into the trailing "No VPC" bucket
    const staging = tree.find((env) => env.envName === "staging");
    expect(staging?.vpcs).toHaveLength(1);
    expect(staging?.vpcs[0].vpcKey).toBe("__no_vpc__");
    expect(staging?.vpcs[0].vpcLabel).toBe("No VPC");
  });

  it("sorts the No VPC bucket after named VPCs in the same env", () => {
    const assets = [
      makeAsset({ id: "no-vpc", env: "prod" }),
      makeAsset({ id: "in-vpc", env: "prod", vpc_id: "vpc-1" }),
    ];
    const prod = buildAssetTree(assets)[0];
    expect(prod.vpcs.map((vpc) => vpc.vpcKey)).toEqual(["vpc-1", "__no_vpc__"]);
  });
});

describe("filterConnectableAssets", () => {
  const assets = [
    makeAsset({ id: "a1", name: "web-prod", env: "prod", private_ip: "10.0.0.5" }),
    makeAsset({ id: "a2", name: "db-staging", env: "staging", private_dns: "db.internal" }),
  ];

  it("returns the original list when query is empty", () => {
    expect(filterConnectableAssets(assets, "")).toEqual(assets);
    expect(filterConnectableAssets(assets, "   ")).toEqual(assets);
  });

  it("matches across name, env, ip, and dns case-insensitively", () => {
    expect(filterConnectableAssets(assets, "WEB").map((a) => a.id)).toEqual(["a1"]);
    expect(filterConnectableAssets(assets, "10.0.0").map((a) => a.id)).toEqual(["a1"]);
    expect(filterConnectableAssets(assets, "internal").map((a) => a.id)).toEqual(["a2"]);
    expect(filterConnectableAssets(assets, "staging").map((a) => a.id)).toEqual(["a2"]);
  });
});

describe("buildLaunchSearch / parseLaunchParams", () => {
  it("round-trips a launch spec via URLSearchParams", () => {
    const spec = { assetID: "asset/one", protocol: "rdp" } as const;
    const search = buildLaunchSearch(spec);
    expect(search).toBe("?launch=asset%2Fone&protocol=rdp");

    const parsed = parseLaunchParams(new URLSearchParams(search));
    expect(parsed).toEqual(spec);
  });

  it("defaults the protocol to ssh when only launch is present", () => {
    expect(parseLaunchParams(new URLSearchParams("?launch=abc"))).toEqual({
      assetID: "abc",
      protocol: "ssh",
    });
  });

  it("returns null when launch is missing or protocol is unsupported", () => {
    expect(parseLaunchParams(new URLSearchParams(""))).toBeNull();
    expect(parseLaunchParams(new URLSearchParams("?launch=abc&protocol=postgres"))).toBeNull();
  });
});
