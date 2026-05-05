import { apiRequest } from "./client";
import { fullPath } from "../lib/basename";
import type { IdentityResponse, LocalLoginRequest, LocalLoginResponse } from "../types/auth";

export const TOKEN_STORAGE_KEY = "ops_platform_access_token";

export function loginLocal(payload: LocalLoginRequest) {
  return apiRequest<LocalLoginResponse>("/auth/local/login", {
    method: "POST",
    body: JSON.stringify(payload),
    skipAuth: true,
  });
}

export function getCurrentIdentity() {
  return apiRequest<IdentityResponse>("/auth/me");
}

export function beginOidcLogin(routerPath = "/") {
  // OIDC `next` is consumed by the backend and must include the production
  // mount prefix (e.g. `/portal/cmdb`) so the callback returns into the app
  // instead of bouncing to the document root.
  const next = fullPath(routerPath, import.meta.env.BASE_URL);
  window.location.href = `/auth/oidc/login?next=${encodeURIComponent(next)}`;
}
