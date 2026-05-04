import type { SSHProxy, SSHProxyAuthType, UpsertSSHProxyPayload } from "../api/connectivity";

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
