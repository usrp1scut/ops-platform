import { describe, expect, it } from "vitest";

import { oidcFormToPayload, oidcSettingsToForm, parseScopes, validateOIDCForm } from "./oidc";

describe("parseScopes", () => {
  it("defaults to the current portal scopes when empty", () => {
    expect(parseScopes("")).toEqual(["openid", "profile", "email"]);
  });

  it("trims and deduplicates comma-separated scopes", () => {
    expect(parseScopes("openid, profile, email, profile")).toEqual(["openid", "profile", "email"]);
  });
});

describe("oidcSettingsToForm", () => {
  it("does not hydrate a saved client secret into form state", () => {
    expect(
      oidcSettingsToForm({
        authorize_url: "https://idp.example.com/authorize",
        client_id: "ops",
        enabled: true,
        has_client_secret: true,
        issuer_url: "https://idp.example.com",
        redirect_url: "https://ops.example.com/auth/oidc/callback",
        scopes: ["openid"],
        token_url: "https://idp.example.com/token",
        userinfo_url: "https://idp.example.com/userinfo",
      }).clientSecret,
    ).toBe("");
  });
});

describe("oidcFormToPayload", () => {
  const baseForm = {
    authorizeURL: "",
    clientID: "ops",
    clientSecret: "",
    enabled: true,
    issuerURL: "https://idp.example.com",
    redirectURL: "https://ops.example.com/auth/oidc/callback",
    scopes: "openid, profile",
    tokenURL: "",
    userInfoURL: "",
  };

  it("omits an empty client secret so the backend can keep the saved value", () => {
    expect(oidcFormToPayload(baseForm)).not.toHaveProperty("client_secret");
  });

  it("includes a new client secret when provided", () => {
    expect(oidcFormToPayload({ ...baseForm, clientSecret: " secret " }).client_secret).toBe("secret");
  });
});

describe("validateOIDCForm", () => {
  it("allows disabled OIDC without required provider fields", () => {
    expect(
      validateOIDCForm({
        authorizeURL: "",
        clientID: "",
        clientSecret: "",
        enabled: false,
        issuerURL: "",
        redirectURL: "",
        scopes: "",
        tokenURL: "",
        userInfoURL: "",
      }),
    ).toBe("");
  });

  it("requires client id and redirect URL when enabled", () => {
    expect(
      validateOIDCForm({
        authorizeURL: "",
        clientID: "",
        clientSecret: "",
        enabled: true,
        issuerURL: "https://idp.example.com",
        redirectURL: "",
        scopes: "",
        tokenURL: "",
        userInfoURL: "",
      }),
    ).toBe("Client ID is required when OIDC is enabled.");
  });
});
