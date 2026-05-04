import { apiRequest } from "./client";

export type OIDCSettings = {
  authorize_url: string;
  client_id: string;
  enabled: boolean;
  has_client_secret: boolean;
  issuer_url: string;
  redirect_url: string;
  scopes: string[];
  token_url: string;
  updated_at?: string;
  userinfo_url: string;
};

export type UpdateOIDCSettingsPayload = {
  authorize_url: string;
  client_id: string;
  client_secret?: string;
  enabled: boolean;
  issuer_url: string;
  redirect_url: string;
  scopes: string[];
  token_url: string;
  userinfo_url: string;
};

export type OIDCConnectionTestResult = {
  authorize_url: string;
  checked_at: string;
  http_status: string;
  http_status_code: number;
  status: string;
};

export function buildOIDCConfigPath() {
  return "/api/v1/iam/oidc-config";
}

export function buildOIDCConfigTestPath() {
  return `${buildOIDCConfigPath()}/test`;
}

export function getOIDCSettings() {
  return apiRequest<OIDCSettings>(buildOIDCConfigPath());
}

export function updateOIDCSettings(payload: UpdateOIDCSettingsPayload) {
  return apiRequest<OIDCSettings>(buildOIDCConfigPath(), {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function testOIDCSettings(payload: UpdateOIDCSettingsPayload) {
  return apiRequest<OIDCConnectionTestResult>(buildOIDCConfigTestPath(), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
