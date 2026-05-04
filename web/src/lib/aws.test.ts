import { describe, expect, it } from "vitest";

import {
  awsFormToCreatePayload,
  awsFormToUpdatePayload,
  parseRegionAllowlist,
  summarizeAwsSyncByAccount,
  validateAwsAccountForm,
  type AwsAccountFormState,
} from "./aws";

const baseForm: AwsAccountFormState = {
  accessKeyID: "",
  accountID: "123456789012",
  authMode: "assume_role",
  displayName: "prod",
  enabled: true,
  externalID: "",
  regionAllowlist: "us-east-1, ap-southeast-1",
  roleARN: "arn:aws:iam::123456789012:role/Ops",
  secretAccessKey: "",
};

describe("parseRegionAllowlist", () => {
  it("trims and deduplicates comma-separated regions", () => {
    expect(parseRegionAllowlist("us-east-1, ap-southeast-1, us-east-1")).toEqual([
      "us-east-1",
      "ap-southeast-1",
    ]);
  });
});

describe("AWS account payload helpers", () => {
  it("builds create payloads with parsed regions", () => {
    expect(awsFormToCreatePayload(baseForm)).toMatchObject({
      account_id: "123456789012",
      region_allowlist: ["us-east-1", "ap-southeast-1"],
    });
  });

  it("omits blank secret on update so the backend keeps the saved value", () => {
    expect(awsFormToUpdatePayload(baseForm)).not.toHaveProperty("secret_access_key");
  });
});

describe("validateAwsAccountForm", () => {
  it("requires static secrets only for new static accounts", () => {
    const form = { ...baseForm, authMode: "static" as const, accessKeyID: "AKIA", roleARN: "" };

    expect(validateAwsAccountForm(form, "create")).toBe("Secret access key is required for new static credentials.");
    expect(validateAwsAccountForm(form, "edit")).toBe("");
  });
});

describe("summarizeAwsSyncByAccount", () => {
  it("tracks latest run, latest success, and latest failure by AWS account id", () => {
    const summary = summarizeAwsSyncByAccount([
      {
        account_display_name: "prod",
        account_id: "123",
        id: "run-1",
        region: "us-east-1",
        resource_type: "ec2",
        resources_processed: 1,
        started_at: "2026-01-01T00:00:00Z",
        status: "success",
      },
      {
        account_display_name: "prod",
        account_id: "123",
        error_message: "boom",
        id: "run-2",
        region: "us-east-1",
        resource_type: "vpc",
        resources_processed: 0,
        started_at: "2026-01-02T00:00:00Z",
        status: "failed",
      },
    ]);

    expect(summary["123"].lastRun?.id).toBe("run-2");
    expect(summary["123"].lastSuccess?.id).toBe("run-1");
    expect(summary["123"].lastFailure?.id).toBe("run-2");
  });
});
