import { describe, expect, it } from "vitest";

import {
  sshProxyCredentialLabels,
  sshProxyFormToPayload,
  sshProxyToForm,
  validateSSHProxyForm,
  type SSHProxyFormState,
} from "./connectivity";

const baseForm: SSHProxyFormState = {
  authType: "password",
  description: "jump host",
  hasPassword: false,
  hasPassphrase: false,
  hasPrivateKey: false,
  host: "10.0.0.10",
  name: "zone-a",
  networkZone: "zone-a",
  passphrase: "",
  password: "secret",
  port: "22",
  privateKey: "",
  username: "ops",
};

describe("sshProxyToForm", () => {
  it("does not hydrate saved credentials into form state", () => {
    expect(
      sshProxyToForm({
        auth_type: "password",
        created_at: "",
        has_passphrase: false,
        has_password: true,
        has_private_key: false,
        host: "10.0.0.10",
        id: "proxy-1",
        name: "zone-a",
        port: 22,
        updated_at: "",
        username: "ops",
      }).password,
    ).toBe("");
  });
});

describe("sshProxyFormToPayload", () => {
  it("omits blank password on update-style payloads", () => {
    expect(sshProxyFormToPayload({ ...baseForm, password: "", hasPassword: true })).not.toHaveProperty("password");
  });

  it("includes key fields only for key auth", () => {
    expect(
      sshProxyFormToPayload({
        ...baseForm,
        authType: "key",
        passphrase: "phrase",
        password: "",
        privateKey: "-----BEGIN KEY-----",
      }),
    ).toMatchObject({
      auth_type: "key",
      passphrase: "phrase",
      private_key: "-----BEGIN KEY-----",
    });
  });
});

describe("validateSSHProxyForm", () => {
  it("requires password for new password proxies", () => {
    expect(validateSSHProxyForm({ ...baseForm, password: "" }, "create")).toBe(
      "Password is required for password auth.",
    );
  });

  it("allows blank password when editing a proxy that already has one", () => {
    expect(validateSSHProxyForm({ ...baseForm, password: "", hasPassword: true }, "edit")).toBe("");
  });
});

describe("sshProxyCredentialLabels", () => {
  it("summarizes saved credential types", () => {
    expect(
      sshProxyCredentialLabels({
        auth_type: "key",
        created_at: "",
        has_passphrase: true,
        has_password: false,
        has_private_key: true,
        host: "10.0.0.10",
        id: "proxy-1",
        name: "zone-a",
        port: 22,
        updated_at: "",
        username: "ops",
      }),
    ).toEqual(["private key", "passphrase"]);
  });
});
