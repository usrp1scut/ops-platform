import type {
  AwsAccount,
  AwsAuthMode,
  AwsSyncRun,
  CreateAwsAccountPayload,
  UpdateAwsAccountPayload,
} from "../api/aws";

export type AwsAccountFormMode = "create" | "edit";

export type AwsAccountFormState = {
  accessKeyID: string;
  accountID: string;
  authMode: AwsAuthMode;
  displayName: string;
  enabled: boolean;
  externalID: string;
  regionAllowlist: string;
  roleARN: string;
  secretAccessKey: string;
};

export type AwsSyncAccountSummary = {
  lastFailure?: AwsSyncRun;
  lastRun?: AwsSyncRun;
  lastSuccess?: AwsSyncRun;
};

export const emptyAwsAccountForm: AwsAccountFormState = {
  accessKeyID: "",
  accountID: "",
  authMode: "assume_role",
  displayName: "",
  enabled: true,
  externalID: "",
  regionAllowlist: "",
  roleARN: "",
  secretAccessKey: "",
};

export function parseRegionAllowlist(value: string) {
  const seen = new Set<string>();

  for (const item of value.split(",")) {
    const region = item.trim();
    if (region) seen.add(region);
  }

  return Array.from(seen);
}

export function awsAccountToForm(account: AwsAccount | undefined): AwsAccountFormState {
  if (!account) return emptyAwsAccountForm;

  return {
    accessKeyID: account.access_key_id || "",
    accountID: account.account_id,
    authMode: account.auth_mode,
    displayName: account.display_name,
    enabled: account.enabled,
    externalID: account.external_id || "",
    regionAllowlist: (account.region_allowlist || []).join(", "),
    roleARN: account.role_arn || "",
    secretAccessKey: "",
  };
}

function compact(value: string) {
  return value.trim() || undefined;
}

export function awsFormToCreatePayload(form: AwsAccountFormState): CreateAwsAccountPayload {
  return {
    access_key_id: compact(form.accessKeyID),
    account_id: form.accountID.trim(),
    auth_mode: form.authMode,
    display_name: form.displayName.trim(),
    enabled: form.enabled,
    external_id: compact(form.externalID),
    region_allowlist: parseRegionAllowlist(form.regionAllowlist),
    role_arn: compact(form.roleARN),
    secret_access_key: compact(form.secretAccessKey),
  };
}

export function awsFormToUpdatePayload(form: AwsAccountFormState): UpdateAwsAccountPayload {
  const payload: UpdateAwsAccountPayload = {
    access_key_id: compact(form.accessKeyID) || "",
    display_name: form.displayName.trim(),
    enabled: form.enabled,
    external_id: compact(form.externalID) || "",
    region_allowlist: parseRegionAllowlist(form.regionAllowlist),
    role_arn: compact(form.roleARN) || "",
  };
  const secret = compact(form.secretAccessKey);

  if (secret) {
    payload.secret_access_key = secret;
  }

  return payload;
}

export function validateAwsAccountForm(form: AwsAccountFormState, mode: AwsAccountFormMode) {
  if (mode === "create" && !form.accountID.trim()) return "Account ID is required.";
  if (!form.displayName.trim()) return "Display name is required.";
  if (form.authMode === "assume_role" && !form.roleARN.trim()) return "Role ARN is required for assume role mode.";
  if (form.authMode === "static" && !form.accessKeyID.trim()) return "Access key ID is required for static mode.";
  if (mode === "create" && form.authMode === "static" && !form.secretAccessKey.trim()) {
    return "Secret access key is required for new static credentials.";
  }

  return "";
}

export function summarizeAwsSyncByAccount(runs: AwsSyncRun[]) {
  const out: Record<string, AwsSyncAccountSummary> = {};

  for (const run of runs) {
    const accountID = run.account_id || "";
    if (!accountID) continue;

    const summary = out[accountID] || {};
    const time = new Date(run.started_at).getTime();
    const lastRunTime = summary.lastRun ? new Date(summary.lastRun.started_at).getTime() : 0;
    if (time >= lastRunTime) summary.lastRun = run;

    if (run.status === "success") {
      const lastSuccessTime = summary.lastSuccess ? new Date(summary.lastSuccess.started_at).getTime() : 0;
      if (time >= lastSuccessTime) summary.lastSuccess = run;
    }

    if (run.status === "failed") {
      const lastFailureTime = summary.lastFailure ? new Date(summary.lastFailure.started_at).getTime() : 0;
      if (time >= lastFailureTime) summary.lastFailure = run;
    }

    out[accountID] = summary;
  }

  return out;
}
