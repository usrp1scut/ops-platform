import { describe, expect, it } from "vitest";

import {
  filterHostKeys,
  hostKeyCounts,
  hostKeyStatusTone,
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

describe("filterHostKeys", () => {
  const hostKeys = [
    {
      created_at: "",
      fingerprint_sha256: "SHA256:abc",
      first_seen_at: "",
      host: "10.0.0.10",
      id: "hk-1",
      key_type: "ssh-ed25519",
      last_seen_at: "",
      port: 22,
      scope: "asset" as const,
      status: "active",
      target_id: "asset-1",
      target_name: "db-prod",
      updated_at: "",
    },
    {
      created_at: "",
      fingerprint_sha256: "SHA256:def",
      first_seen_at: "",
      host: "10.0.0.20",
      id: "hk-2",
      key_type: "rsa",
      last_seen_at: "",
      port: 22,
      scope: "proxy" as const,
      status: "override_pending",
      target_id: "proxy-1",
      target_name: "zone-a",
      updated_at: "",
    },
  ];

  it("filters by scope", () => {
    expect(filterHostKeys(hostKeys, { query: "", scope: "proxy" }).map((item) => item.id)).toEqual(["hk-2"]);
  });

  it("searches target, host, and fingerprint fields", () => {
    expect(filterHostKeys(hostKeys, { query: "abc", scope: "all" }).map((item) => item.id)).toEqual(["hk-1"]);
  });
});

describe("hostKeyCounts", () => {
  it("counts pinned, override pending, and active mismatches", () => {
    expect(
      hostKeyCounts([
        {
          created_at: "",
          fingerprint_sha256: "SHA256:abc",
          first_seen_at: "",
          host: "10.0.0.10",
          id: "hk-1",
          key_type: "ssh-ed25519",
          last_mismatch_at: "2026-01-01T00:00:00Z",
          last_seen_at: "",
          port: 22,
          scope: "asset",
          status: "active",
          target_id: "asset-1",
          updated_at: "",
        },
        {
          created_at: "",
          fingerprint_sha256: "SHA256:def",
          first_seen_at: "",
          host: "10.0.0.20",
          id: "hk-2",
          key_type: "rsa",
          last_seen_at: "",
          port: 22,
          scope: "proxy",
          status: "override_pending",
          target_id: "proxy-1",
          updated_at: "",
        },
      ]),
    ).toEqual({ mismatched: 1, pending: 1, pinned: 2 });
  });
});

describe("hostKeyStatusTone", () => {
  it("marks active mismatches as warnings", () => {
    expect(
      hostKeyStatusTone({
        created_at: "",
        fingerprint_sha256: "SHA256:abc",
        first_seen_at: "",
        host: "10.0.0.10",
        id: "hk-1",
        key_type: "ssh-ed25519",
        last_mismatch_at: "2026-01-01T00:00:00Z",
        last_seen_at: "",
        port: 22,
        scope: "asset",
        status: "active",
        target_id: "asset-1",
        updated_at: "",
      }),
    ).toBe("warn");
  });
});
