import type { OIDCSettings, UpdateOIDCSettingsPayload } from "../api/oidc";

export type OIDCSettingsFormState = {
  authorizeURL: string;
  clientID: string;
  clientSecret: string;
  enabled: boolean;
  issuerURL: string;
  redirectURL: string;
  scopes: string;
  tokenURL: string;
  userInfoURL: string;
};

const defaultScopes = ["openid", "profile", "email"];

export function parseScopes(value: string) {
  const raw = value.trim();
  if (!raw) return defaultScopes;

  const seen = new Set<string>();
  for (const item of raw.split(",")) {
    const scope = item.trim();
    if (scope) seen.add(scope);
  }

  return Array.from(seen);
}

export function oidcSettingsToForm(settings: OIDCSettings | undefined): OIDCSettingsFormState {
  return {
    authorizeURL: settings?.authorize_url || "",
    clientID: settings?.client_id || "",
    clientSecret: "",
    enabled: Boolean(settings?.enabled),
    issuerURL: settings?.issuer_url || "",
    redirectURL: settings?.redirect_url || "",
    scopes: (settings?.scopes?.length ? settings.scopes : defaultScopes).join(", "),
    tokenURL: settings?.token_url || "",
    userInfoURL: settings?.userinfo_url || "",
  };
}

export function oidcFormToPayload(form: OIDCSettingsFormState): UpdateOIDCSettingsPayload {
  const payload: UpdateOIDCSettingsPayload = {
    authorize_url: form.authorizeURL.trim(),
    client_id: form.clientID.trim(),
    enabled: form.enabled,
    issuer_url: form.issuerURL.trim(),
    redirect_url: form.redirectURL.trim(),
    scopes: parseScopes(form.scopes),
    token_url: form.tokenURL.trim(),
    userinfo_url: form.userInfoURL.trim(),
  };
  const clientSecret = form.clientSecret.trim();

  if (clientSecret) {
    payload.client_secret = clientSecret;
  }

  return payload;
}

export function validateOIDCForm(form: OIDCSettingsFormState) {
  if (!form.enabled) return "";

  if (!form.clientID.trim()) return "Client ID is required when OIDC is enabled.";
  if (!form.redirectURL.trim()) return "Redirect URL is required when OIDC is enabled.";

  const hasIssuer = Boolean(form.issuerURL.trim());
  if (!hasIssuer && !form.authorizeURL.trim()) return "Issuer URL or authorize URL is required.";
  if (!hasIssuer && !form.tokenURL.trim()) return "Issuer URL or token URL is required.";
  if (!hasIssuer && !form.userInfoURL.trim()) return "Issuer URL or userinfo URL is required.";

  return "";
}
