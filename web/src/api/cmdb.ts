import { apiRequest } from "./client";

export type Asset = {
  id: string;
  type: string;
  name: string;
  status: string;
  env: string;
  source: string;
  external_id?: string;
  external_arn?: string;
  ami_name?: string;
  ami_owner_id?: string;
  public_ip?: string;
  private_ip?: string;
  private_dns?: string;
  region?: string;
  zone?: string;
  account_id?: string;
  instance_type?: string;
  os_image?: string;
  os_family?: string;
  vpc_id?: string;
  subnet_id?: string;
  key_name?: string;
  owner?: string;
  business_unit?: string;
  criticality?: string;
  expires_at?: string;
  is_vpc_proxy?: boolean;
  system_tags?: Record<string, unknown>;
  labels?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ListAssetsResponse = {
  items: Asset[];
  total: number;
  limit: number;
  offset: number;
};

export type AssetFacets = {
  envs: string[];
  regions: string[];
  sources: string[];
  statuses: string[];
  types: string[];
};

export type AssetConnectionProfile = {
  asset_id: string;
  auth_type: string;
  bastion_enabled: boolean;
  created_at: string;
  database?: string;
  has_passphrase: boolean;
  has_password: boolean;
  has_private_key: boolean;
  host: string;
  last_probe_at?: string;
  last_probe_error?: string;
  last_probe_status?: string;
  port: number;
  protocol: string;
  proxy_id?: string;
  proxy_name?: string;
  proxy_zone?: string;
  updated_at: string;
  username: string;
};

export type AssetConnectionTestResult = {
  status: string;
};

export type UpdateAssetConnectionProfilePayload = {
  auth_type: string;
  bastion_enabled: boolean;
  database?: string;
  host: string;
  passphrase?: string;
  password?: string;
  port: number;
  private_key?: string;
  protocol: string;
  proxy_id?: string;
  username: string;
};

export type AssetProbeSnapshot = {
  arch: string;
  asset_id: string;
  collected_at: string;
  collected_by: string;
  cpu_cores: number;
  cpu_model: string;
  disk_summary: string;
  hostname: string;
  id: string;
  kernel: string;
  memory_mb: number;
  os_name: string;
  os_version: string;
  raw?: Record<string, unknown>;
  software: string[];
  uptime_seconds: number;
};

export type AssetRelation = {
  created_at: string;
  from_asset_id: string;
  from_name?: string;
  from_type?: string;
  id: string;
  relation_type: string;
  source: string;
  to_asset_id: string;
  to_name?: string;
  to_type?: string;
  updated_at: string;
};

export type ListAssetsOptions = {
  accountID?: string;
  criticality?: string;
  env?: string;
  isVPCProxy?: boolean;
  limit?: number;
  offset?: number;
  owner?: string;
  query?: string;
  region?: string;
  source?: string;
  status?: string;
  type?: string;
};

export function buildAssetsQuery(options: ListAssetsOptions = {}) {
  const params = new URLSearchParams();

  if (options.type) params.set("type", options.type);
  if (options.env) params.set("env", options.env);
  if (options.status) params.set("status", options.status);
  if (options.source) params.set("source", options.source);
  if (options.region) params.set("region", options.region);
  if (options.accountID) params.set("account_id", options.accountID);
  if (options.owner) params.set("owner", options.owner);
  if (options.criticality) params.set("criticality", options.criticality);
  if (options.query) params.set("q", options.query);
  if (options.isVPCProxy !== undefined) params.set("is_vpc_proxy", String(options.isVPCProxy));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));

  return params.toString();
}

export function buildAssetPath(assetID: string) {
  return `/api/v1/cmdb/assets/${encodeURIComponent(assetID)}`;
}

export function buildAssetConnectionPath(assetID: string) {
  return `${buildAssetPath(assetID)}/connection`;
}

export function buildAssetConnectionTestPath(assetID: string) {
  return `${buildAssetConnectionPath(assetID)}/test`;
}

export function buildAssetProbePath(assetID: string) {
  return `${buildAssetPath(assetID)}/probe/latest`;
}

export function buildAssetRelationsPath(assetID: string) {
  return `${buildAssetPath(assetID)}/relations`;
}

export function listAssets(options: ListAssetsOptions = {}) {
  const params = buildAssetsQuery(options);
  const path = params ? `/api/v1/cmdb/assets?${params}` : "/api/v1/cmdb/assets";

  return apiRequest<ListAssetsResponse>(path);
}

export function getAsset(assetID: string) {
  return apiRequest<Asset>(buildAssetPath(assetID));
}

export function getAssetConnectionProfile(assetID: string) {
  return apiRequest<AssetConnectionProfile>(buildAssetConnectionPath(assetID));
}

export function updateAssetConnectionProfile(assetID: string, payload: UpdateAssetConnectionProfilePayload) {
  return apiRequest<AssetConnectionProfile>(buildAssetConnectionPath(assetID), {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function testAssetConnection(assetID: string) {
  return apiRequest<AssetConnectionTestResult>(buildAssetConnectionTestPath(assetID), {
    method: "POST",
    body: "{}",
  });
}

export function getLatestAssetProbe(assetID: string) {
  return apiRequest<AssetProbeSnapshot>(buildAssetProbePath(assetID));
}

export function listAssetRelations(assetID: string) {
  return apiRequest<AssetRelation[]>(buildAssetRelationsPath(assetID));
}

export function listAssetFacets() {
  return apiRequest<AssetFacets>("/api/v1/cmdb/assets/facets");
}
