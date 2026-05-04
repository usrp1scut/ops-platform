import { apiRequest } from "./client";
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

export function beginOidcLogin(nextPath = "/") {
  window.location.href = `/auth/oidc/login?next=${encodeURIComponent(nextPath)}`;
}
