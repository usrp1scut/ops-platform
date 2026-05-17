// Helpers shared by the CMDB list (Connect shortcut on each row) and the
// Sessions page (sidebar tree of connectable assets, plus the auto-launch
// flow when the row link sends `?launch=<assetID>&protocol=...`).
//
// The legacy classic-script portal had the same conventions; keeping these
// in a small framework-free module makes them easy to unit test and avoids
// duplicating the env/vpc grouping rules between two pages.

import type { Asset } from "../api/cmdb";

export type LaunchProtocol = "ssh" | "rdp" | "vnc" | "telnet";

// Mirrors NON_CONNECTABLE_TYPES from internal/httpserver/ui/portal/app.js.
// Anything that is clearly a network primitive or AWS bookkeeping object —
// VPCs, subnets, S3 buckets, IAM principals — should not appear in the
// "connectable" set. EC2 instances, RDS instances, manual hosts, and
// anything else stay connectable so operators can still try.
const NON_CONNECTABLE_TYPES = new Set([
  "aws_vpc",
  "vpc",
  "aws_subnet",
  "subnet",
  "aws_security_group",
  "security_group",
  "aws_route_table",
  "route_table",
  "aws_internet_gateway",
  "internet_gateway",
  "aws_nat_gateway",
  "nat_gateway",
  "aws_ebs_volume",
  "ebs_volume",
  "aws_elb",
  "elb",
  "alb",
  "nlb",
  "aws_s3_bucket",
  "s3_bucket",
  "aws_iam_role",
  "iam_role",
  "aws_iam_user",
  "iam_user",
  "aws_account",
  "aws_region",
]);

export function isConnectableAsset(asset: Asset | null | undefined): boolean {
  if (!asset) return false;
  return !NON_CONNECTABLE_TYPES.has((asset.type || "").toLowerCase());
}

export type AssetTreeVPC = {
  vpcKey: string;
  vpcLabel: string;
  bastions: Asset[];
  members: Asset[];
  count: number;
};

export type AssetTreeEnv = {
  envName: string;
  total: number;
  vpcs: AssetTreeVPC[];
};

const NO_VPC_KEY = "__no_vpc__";

// Group a flat list of assets into the env → vpc → (bastions, members)
// shape the legacy sidebar used. Assets with `is_vpc_proxy === true` show
// up in the bastions bucket; everything else lands in members. Unknown
// env defaults to "default"; unknown vpc collapses into a single "No VPC"
// bucket sorted to the bottom.
export function buildAssetTree(assets: Asset[]): AssetTreeEnv[] {
  const envs = new Map<string, Map<string, { bastions: Asset[]; members: Asset[] }>>();

  for (const asset of assets) {
    const envKey = asset.env || "default";
    if (!envs.has(envKey)) envs.set(envKey, new Map());
    const vpcs = envs.get(envKey)!;

    const vpcKey = asset.vpc_id || NO_VPC_KEY;
    if (!vpcs.has(vpcKey)) vpcs.set(vpcKey, { bastions: [], members: [] });
    const bucket = vpcs.get(vpcKey)!;

    if (asset.is_vpc_proxy) bucket.bastions.push(asset);
    else bucket.members.push(asset);
  }

  return [...envs.keys()].sort().map((envName) => {
    const vpcs = envs.get(envName)!;
    const vpcEntries = [...vpcs.keys()]
      .sort((a, b) => {
        if (a === NO_VPC_KEY) return 1;
        if (b === NO_VPC_KEY) return -1;
        return a.localeCompare(b);
      })
      .map<AssetTreeVPC>((vpcKey) => {
        const { bastions, members } = vpcs.get(vpcKey)!;
        return {
          vpcKey,
          vpcLabel: vpcKey === NO_VPC_KEY ? "No VPC" : vpcKey,
          bastions,
          members,
          count: bastions.length + members.length,
        };
      });
    const total = vpcEntries.reduce((sum, vpc) => sum + vpc.count, 0);
    return { envName, total, vpcs: vpcEntries };
  });
}

// The env bucket an asset falls into, matching buildAssetTree's rule so
// the env facet options line up 1:1 with the tree headings.
export function assetEnvKey(asset: Asset): string {
  return asset.env || "default";
}

// Case-insensitive match of `needle` against an asset's merged tags
// (system_tags + labels + tags). Matches a tag key, a value, or a
// "key:value" pair as a substring. An empty needle matches everything.
export function assetMatchesTag(asset: Asset, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  const merged: Record<string, unknown> = {
    ...(asset.system_tags || {}),
    ...(asset.labels || {}),
    ...(asset.tags || {}),
  };
  for (const [key, value] of Object.entries(merged)) {
    const v = value == null ? "" : String(value);
    if (
      key.toLowerCase().includes(q) ||
      v.toLowerCase().includes(q) ||
      `${key}:${v}`.toLowerCase().includes(q)
    ) {
      return true;
    }
  }
  return false;
}

// Case-insensitive text search across the fields the legacy sidebar used
// for filtering (name, id, type, env, ips, dns, vpc).
export function filterConnectableAssets(assets: Asset[], query: string): Asset[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return assets;
  return assets.filter((asset) => {
    const haystack = [
      asset.name,
      asset.id,
      asset.type,
      asset.env,
      asset.public_ip,
      asset.private_ip,
      asset.private_dns,
      asset.vpc_id,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export type LaunchSpec = {
  assetID: string;
  protocol: LaunchProtocol;
};

export function buildLaunchSearch(spec: LaunchSpec): string {
  const params = new URLSearchParams({
    launch: spec.assetID,
    protocol: spec.protocol,
  });
  return `?${params.toString()}`;
}

// Cross-page deep-link target for the Audit page. Param names are kept
// distinct from the launch params (`launch`/`protocol`) so a single URL
// can't be ambiguous, and `status` is omitted when it's the default so
// links stay short and shareable.
export type AuditQuery = {
  assetID?: string;
  userID?: string;
  status?: string;
};

export function buildAuditSearch(query: AuditQuery): string {
  const params = new URLSearchParams();
  if (query.assetID) params.set("asset", query.assetID);
  if (query.userID) params.set("user", query.userID);
  if (query.status && query.status !== "all") params.set("status", query.status);
  const search = params.toString();
  return search ? `?${search}` : "";
}

// Read the (assetID, protocol) tuple from a URLSearchParams instance and
// return null if either field is missing or the protocol isn't one of the
// supported values. The Sessions page consumes this on mount to auto-fire
// a launch sent from the CMDB row.
export function parseLaunchParams(search: URLSearchParams): LaunchSpec | null {
  const assetID = search.get("launch");
  if (!assetID) return null;
  // Protocol is advisory only: the Sessions page launches by the asset's
  // connection-profile protocol (single source of truth), so an unknown or
  // missing value must not drop the deep link.
  const raw = (search.get("protocol") || "ssh").toLowerCase();
  const protocol: LaunchProtocol =
    raw === "rdp" || raw === "vnc" || raw === "telnet" ? raw : "ssh";
  return { assetID, protocol };
}
