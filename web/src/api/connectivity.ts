import { apiRequest } from "./client";

export type SSHProxyAuthType = "password" | "key";
export type HostKeyScope = "asset" | "proxy";

export type SSHProxy = {
  auth_type: SSHProxyAuthType;
  created_at: string;
  description?: string;
  has_passphrase: boolean;
  has_password: boolean;
  has_private_key: boolean;
  host: string;
  id: string;
  name: string;
  network_zone?: string;
  port: number;
  updated_at: string;
  username: string;
};

export type UpsertSSHProxyPayload = {
  auth_type: SSHProxyAuthType;
  description: string;
  host: string;
  name: string;
  network_zone: string;
  passphrase?: string;
  password?: string;
  port: number;
  private_key?: string;
  username: string;
};

export type ListSSHProxiesResponse = {
  items: SSHProxy[];
};

export type DeleteSSHProxyResponse = {
  status: string;
};

export type SSHKeypair = {
  created_at: string;
  description?: string;
  fingerprint: string;
  has_passphrase: boolean;
  id: string;
  name: string;
  updated_at: string;
  uploaded_by?: string;
};

export type UpsertSSHKeypairPayload = {
  description: string;
  name: string;
  passphrase?: string;
  private_key: string;
};

export type DeleteSSHKeypairResponse = {
  status: string;
};

export type HostKeyRecord = {
  created_at: string;
  fingerprint_sha256: string;
  first_seen_at: string;
  host: string;
  id: string;
  key_type: string;
  last_mismatch_at?: string;
  last_mismatch_fingerprint?: string;
  last_seen_at: string;
  override_at?: string;
  override_by?: string;
  override_expires_at?: string;
  port: number;
  scope: HostKeyScope;
  status: string;
  target_id: string;
  target_name?: string;
  updated_at: string;
};

export type ListHostKeysResponse = {
  items: HostKeyRecord[];
};

export type ApproveHostKeyOverrideResponse = {
  status: string;
  ttl_minute: number;
};

export function buildSSHProxyPath(proxyID: string) {
  return `/api/v1/cmdb/ssh-proxies/${encodeURIComponent(proxyID)}`;
}

export function buildSSHKeypairPath(keypairID: string) {
  return `/api/v1/ssh-keypairs/${encodeURIComponent(keypairID)}`;
}

export function buildHostKeyPath(scope: HostKeyScope, targetID: string) {
  return `/api/v1/cmdb/hostkeys/${encodeURIComponent(scope)}/${encodeURIComponent(targetID)}`;
}

export function buildHostKeyOverridePath(scope: HostKeyScope, targetID: string) {
  return `${buildHostKeyPath(scope, targetID)}/override`;
}

export function listSSHProxies() {
  return apiRequest<ListSSHProxiesResponse>("/api/v1/cmdb/ssh-proxies");
}

export function createSSHProxy(payload: UpsertSSHProxyPayload) {
  return apiRequest<SSHProxy>("/api/v1/cmdb/ssh-proxies", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSSHProxy(proxyID: string, payload: UpsertSSHProxyPayload) {
  return apiRequest<SSHProxy>(buildSSHProxyPath(proxyID), {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteSSHProxy(proxyID: string) {
  return apiRequest<DeleteSSHProxyResponse>(buildSSHProxyPath(proxyID), {
    method: "DELETE",
  });
}

export function listSSHKeypairs() {
  return apiRequest<SSHKeypair[]>("/api/v1/ssh-keypairs/");
}

export function upsertSSHKeypair(payload: UpsertSSHKeypairPayload) {
  return apiRequest<SSHKeypair>("/api/v1/ssh-keypairs/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteSSHKeypair(keypairID: string) {
  return apiRequest<DeleteSSHKeypairResponse>(buildSSHKeypairPath(keypairID), {
    method: "DELETE",
  });
}

export function listHostKeys() {
  return apiRequest<ListHostKeysResponse>("/api/v1/cmdb/hostkeys/");
}

export function approveHostKeyOverride(scope: HostKeyScope, targetID: string) {
  return apiRequest<ApproveHostKeyOverrideResponse>(buildHostKeyOverridePath(scope, targetID), {
    method: "POST",
    body: "{}",
  });
}

export function deleteHostKey(scope: HostKeyScope, targetID: string) {
  return apiRequest<Record<string, never>>(buildHostKeyPath(scope, targetID), {
    method: "DELETE",
  });
}
