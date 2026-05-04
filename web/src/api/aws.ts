import { apiRequest } from "./client";

export type AwsAuthMode = "assume_role" | "static";
export type AwsSyncRunStatus = "running" | "success" | "failed";

export type AwsAccount = {
  access_key_id?: string;
  account_id: string;
  auth_mode: AwsAuthMode;
  created_at: string;
  display_name: string;
  enabled: boolean;
  external_id?: string;
  id: string;
  region_allowlist: string[];
  role_arn?: string;
  updated_at: string;
};

export type CreateAwsAccountPayload = {
  access_key_id?: string;
  account_id: string;
  auth_mode: AwsAuthMode;
  display_name: string;
  enabled: boolean;
  external_id?: string;
  region_allowlist: string[];
  role_arn?: string;
  secret_access_key?: string;
};

export type UpdateAwsAccountPayload = {
  access_key_id?: string;
  display_name?: string;
  enabled?: boolean;
  external_id?: string;
  region_allowlist?: string[];
  role_arn?: string;
  secret_access_key?: string;
};

export type AwsConnectionTestResult = {
  account_id: string;
  arn: string;
  checked_at: string;
  region: string;
  status: string;
  user_id: string;
};

export type AwsSyncStatus = {
  last_error?: string;
  last_finished_at?: string;
  last_started_at?: string;
  running: boolean;
};

export type AwsSyncRun = {
  account_display_name: string;
  account_id: string;
  error_message?: string;
  finished_at?: string;
  id: string;
  region: string;
  resource_type: string;
  resources_processed: number;
  started_at: string;
  status: AwsSyncRunStatus;
};

export type AwsSyncTriggerResponse = {
  message: string;
  status: AwsSyncStatus;
  triggered: boolean;
};

export type ListAwsAccountsResponse = {
  items: AwsAccount[];
};

export type ListAwsSyncRunsResponse = {
  items: AwsSyncRun[];
  limit: number;
};

export type ListAwsSyncRunsOptions = {
  limit?: number;
};

export function buildAwsAccountPath(accountID: string) {
  return `/api/v1/aws/accounts/${encodeURIComponent(accountID)}`;
}

export function buildAwsAccountTestPath(accountID: string) {
  return `${buildAwsAccountPath(accountID)}/test`;
}

export function buildAwsSyncRunsQuery(options: ListAwsSyncRunsOptions = {}) {
  const params = new URLSearchParams();

  if (options.limit !== undefined) params.set("limit", String(options.limit));

  return params.toString();
}

export function listAwsAccounts() {
  return apiRequest<ListAwsAccountsResponse>("/api/v1/aws/accounts");
}

export function createAwsAccount(payload: CreateAwsAccountPayload) {
  return apiRequest<AwsAccount>("/api/v1/aws/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAwsAccount(accountID: string, payload: UpdateAwsAccountPayload) {
  return apiRequest<AwsAccount>(buildAwsAccountPath(accountID), {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function testAwsAccount(accountID: string) {
  return apiRequest<AwsConnectionTestResult>(buildAwsAccountTestPath(accountID), {
    method: "POST",
    body: "{}",
  });
}

export function getAwsSyncStatus() {
  return apiRequest<AwsSyncStatus>("/api/v1/aws/sync/status");
}

export function listAwsSyncRuns(options: ListAwsSyncRunsOptions = {}) {
  const params = buildAwsSyncRunsQuery(options);
  const path = params ? `/api/v1/aws/sync/runs?${params}` : "/api/v1/aws/sync/runs";

  return apiRequest<ListAwsSyncRunsResponse>(path);
}

export function triggerAwsSync() {
  return apiRequest<AwsSyncTriggerResponse>("/api/v1/aws/sync/run", {
    method: "POST",
    body: "{}",
  });
}
