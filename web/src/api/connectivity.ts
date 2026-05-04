import { apiRequest } from "./client";

export type SSHProxyAuthType = "password" | "key";

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

export function buildSSHProxyPath(proxyID: string) {
  return `/api/v1/cmdb/ssh-proxies/${encodeURIComponent(proxyID)}`;
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
