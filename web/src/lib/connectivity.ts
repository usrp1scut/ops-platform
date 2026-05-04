import type {
  HostKeyRecord,
  HostKeyScope,
  SSHKeypair,
  SSHProxy,
  SSHProxyAuthType,
  UpsertSSHKeypairPayload,
  UpsertSSHProxyPayload,
} from "../api/connectivity";

export type SSHProxyFormMode = "create" | "edit";

export type SSHProxyFormState = {
  authType: SSHProxyAuthType;
  description: string;
  hasPassword: boolean;
  hasPassphrase: boolean;
  hasPrivateKey: boolean;
  host: string;
  name: string;
  networkZone: string;
  passphrase: string;
  password: string;
  port: string;
  privateKey: string;
  username: string;
};

export type HostKeyFilters = {
  query: string;
  scope: "all" | HostKeyScope;
};

export type HostKeyCounts = {
  mismatched: number;
  pinned: number;
  pending: number;
};

export type SSHKeypairFormState = {
  description: string;
  name: string;
  passphrase: string;
  privateKey: string;
};

export const emptySSHProxyForm: SSHProxyFormState = {
  authType: "password",
  description: "",
  hasPassword: false,
  hasPassphrase: false,
  hasPrivateKey: false,
  host: "",
  name: "",
  networkZone: "",
  passphrase: "",
  password: "",
  port: "22",
  privateKey: "",
  username: "",
};

export const emptySSHKeypairForm: SSHKeypairFormState = {
  description: "",
  name: "",
  passphrase: "",
  privateKey: "",
};

export function sshProxyToForm(proxy: SSHProxy | undefined): SSHProxyFormState {
  if (!proxy) return emptySSHProxyForm;

  return {
    authType: proxy.auth_type || "password",
    description: proxy.description || "",
    hasPassword: proxy.has_password,
    hasPassphrase: proxy.has_passphrase,
    hasPrivateKey: proxy.has_private_key,
    host: proxy.host || "",
    name: proxy.name || "",
    networkZone: proxy.network_zone || "",
    passphrase: "",
    password: "",
    port: String(proxy.port || 22),
    privateKey: "",
    username: proxy.username || "",
  };
}

export function sshProxyFormToPayload(form: SSHProxyFormState): UpsertSSHProxyPayload {
  const payload: UpsertSSHProxyPayload = {
    auth_type: form.authType || "password",
    description: form.description.trim(),
    host: form.host.trim(),
    name: form.name.trim(),
    network_zone: form.networkZone.trim(),
    port: Number(form.port) || 22,
    username: form.username.trim(),
  };

  if (form.authType === "password" && form.password.trim()) {
    payload.password = form.password;
  }
  if (form.authType === "key") {
    if (form.privateKey.trim()) payload.private_key = form.privateKey;
    if (form.passphrase.trim()) payload.passphrase = form.passphrase;
  }

  return payload;
}

export function validateSSHProxyForm(form: SSHProxyFormState, mode: SSHProxyFormMode) {
  if (!form.name.trim()) return "Name is required.";
  if (!form.host.trim()) return "Host is required.";
  if (!form.username.trim()) return "Username is required.";

  const port = Number(form.port);
  if (!Number.isFinite(port) || port <= 0) return "Port must be a positive number.";

  if (form.authType === "password") {
    const hasSavedPassword = mode === "edit" && form.hasPassword;
    if (!hasSavedPassword && !form.password.trim()) return "Password is required for password auth.";
  }

  if (form.authType === "key") {
    const hasSavedKey = mode === "edit" && form.hasPrivateKey;
    if (!hasSavedKey && !form.privateKey.trim()) return "Private key is required for key auth.";
  }

  return "";
}

export function sshProxyCredentialLabels(proxy: SSHProxy) {
  return [
    proxy.has_password ? "password" : "",
    proxy.has_private_key ? "private key" : "",
    proxy.has_passphrase ? "passphrase" : "",
  ].filter(Boolean);
}

export function sshKeypairFormToPayload(form: SSHKeypairFormState): UpsertSSHKeypairPayload {
  const payload: UpsertSSHKeypairPayload = {
    description: form.description.trim(),
    name: form.name.trim(),
    private_key: form.privateKey,
  };

  if (form.passphrase.trim()) {
    payload.passphrase = form.passphrase;
  }

  return payload;
}

export function validateSSHKeypairForm(form: SSHKeypairFormState) {
  if (!form.name.trim()) return "Name is required.";
  if (!form.privateKey.trim()) return "Private key is required.";

  return "";
}

export function filterSSHKeypairs(items: SSHKeypair[], queryValue: string) {
  const query = queryValue.trim().toLowerCase();
  if (!query) return items;

  return items.filter((item) =>
    [item.name, item.fingerprint, item.description, item.uploaded_by].some((value) =>
      (value || "").toLowerCase().includes(query),
    ),
  );
}

export function filterHostKeys(items: HostKeyRecord[], filters: HostKeyFilters) {
  const query = filters.query.trim().toLowerCase();

  return items.filter((item) => {
    if (filters.scope !== "all" && item.scope !== filters.scope) return false;
    if (!query) return true;

    return [item.target_name, item.target_id, item.host, item.fingerprint_sha256].some((value) =>
      (value || "").toLowerCase().includes(query),
    );
  });
}

export function hostKeyCounts(items: HostKeyRecord[]): HostKeyCounts {
  return {
    mismatched: items.filter((item) => item.status === "active" && Boolean(item.last_mismatch_at)).length,
    pending: items.filter((item) => item.status === "override_pending").length,
    pinned: items.length,
  };
}

export function hostKeyStatusTone(item: HostKeyRecord) {
  if (item.status === "override_pending") return "info";
  if (item.status === "active" && item.last_mismatch_at) return "warn";
  if (item.status === "active") return "ok";
  return "";
}
