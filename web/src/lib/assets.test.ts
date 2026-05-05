import { describe, expect, it } from "vitest";

import type { Asset } from "../api/cmdb";
import {
  assetFormToCreatePayload,
  assetFormToUpdatePayload,
  assetToForm,
  emptyAssetForm,
  formatAssetRange,
  nextAssetOffset,
  previousAssetOffset,
  validateAssetForm,
} from "./assets";

describe("formatAssetRange", () => {
  it("formats an empty result", () => {
    expect(formatAssetRange(0, 0, 0)).toBe("0 assets");
  });

  it("formats a partial last page", () => {
    expect(formatAssetRange(53, 50, 3)).toBe("51-53 of 53");
  });
});

describe("asset pagination offsets", () => {
  it("does not move before the first page", () => {
    expect(previousAssetOffset(10, 25)).toBe(0);
  });

  it("does not move beyond the last page", () => {
    expect(nextAssetOffset(50, 25, 53)).toBe(50);
  });

  it("moves to the next page when available", () => {
    expect(nextAssetOffset(25, 25, 100)).toBe(50);
  });
});

const sampleAsset: Asset = {
  account_id: "123456789012",
  business_unit: "Platform",
  created_at: "2026-01-01T00:00:00Z",
  criticality: "high",
  env: "prod",
  external_id: "i-abc",
  id: "asset-1",
  instance_type: "t3.large",
  name: "db-primary",
  os_image: "ami-1",
  owner: "ops",
  private_dns: "ip-10-0-0-5.ec2.internal",
  private_ip: "10.0.0.5",
  public_ip: "1.2.3.4",
  region: "us-east-1",
  source: "aws",
  status: "active",
  subnet_id: "subnet-1",
  type: "ec2",
  updated_at: "2026-01-02T00:00:00Z",
  vpc_id: "vpc-1",
  zone: "us-east-1a",
};

describe("validateAssetForm", () => {
  it("requires name in any mode", () => {
    expect(validateAssetForm(emptyAssetForm, "create")).toBe("Name is required.");
    expect(validateAssetForm({ ...emptyAssetForm, name: "x" }, "edit")).toBe("");
  });

  it("requires type only on create", () => {
    const named = { ...emptyAssetForm, name: "x" };
    expect(validateAssetForm(named, "create")).toBe("Type is required.");
    expect(validateAssetForm(named, "edit")).toBe("");
  });
});

describe("assetToForm", () => {
  it("maps an asset record back into form state", () => {
    expect(assetToForm(sampleAsset)).toEqual({
      accountID: "123456789012",
      businessUnit: "Platform",
      criticality: "high",
      env: "prod",
      externalID: "i-abc",
      instanceType: "t3.large",
      name: "db-primary",
      osImage: "ami-1",
      owner: "ops",
      privateDNS: "ip-10-0-0-5.ec2.internal",
      privateIP: "10.0.0.5",
      publicIP: "1.2.3.4",
      region: "us-east-1",
      source: "aws",
      status: "active",
      subnetID: "subnet-1",
      type: "ec2",
      vpcID: "vpc-1",
      zone: "us-east-1a",
    });
  });
});

describe("assetFormToCreatePayload", () => {
  it("includes only required and non-empty optional fields", () => {
    expect(
      assetFormToCreatePayload({
        ...emptyAssetForm,
        env: " prod ",
        name: " web-1 ",
        type: " ec2 ",
      }),
    ).toEqual({
      env: "prod",
      name: "web-1",
      type: "ec2",
    });
  });
});

describe("assetFormToUpdatePayload", () => {
  it("emits every editable field including blanks for clearing", () => {
    expect(
      assetFormToUpdatePayload({
        ...emptyAssetForm,
        env: "prod",
        name: "web-1",
        owner: "platform",
      }),
    ).toEqual({
      account_id: "",
      business_unit: "",
      criticality: "",
      env: "prod",
      instance_type: "",
      name: "web-1",
      os_image: "",
      owner: "platform",
      private_dns: "",
      private_ip: "",
      public_ip: "",
      region: "",
      status: "",
      subnet_id: "",
      vpc_id: "",
      zone: "",
    });
  });
});
