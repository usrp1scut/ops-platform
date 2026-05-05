import type { Asset, CreateAssetPayload, UpdateAssetPayload } from "../api/cmdb";

export type AssetFormMode = "create" | "edit";

export type AssetFormState = {
  accountID: string;
  businessUnit: string;
  criticality: string;
  env: string;
  externalID: string;
  instanceType: string;
  name: string;
  osImage: string;
  owner: string;
  privateDNS: string;
  privateIP: string;
  publicIP: string;
  region: string;
  source: string;
  status: string;
  subnetID: string;
  type: string;
  vpcID: string;
  zone: string;
};

export const emptyAssetForm: AssetFormState = {
  accountID: "",
  businessUnit: "",
  criticality: "",
  env: "",
  externalID: "",
  instanceType: "",
  name: "",
  osImage: "",
  owner: "",
  privateDNS: "",
  privateIP: "",
  publicIP: "",
  region: "",
  source: "",
  status: "",
  subnetID: "",
  type: "",
  vpcID: "",
  zone: "",
};

export function assetToForm(asset: Asset): AssetFormState {
  return {
    accountID: asset.account_id || "",
    businessUnit: asset.business_unit || "",
    criticality: asset.criticality || "",
    env: asset.env || "",
    externalID: asset.external_id || "",
    instanceType: asset.instance_type || "",
    name: asset.name || "",
    osImage: asset.os_image || "",
    owner: asset.owner || "",
    privateDNS: asset.private_dns || "",
    privateIP: asset.private_ip || "",
    publicIP: asset.public_ip || "",
    region: asset.region || "",
    source: asset.source || "",
    status: asset.status || "",
    subnetID: asset.subnet_id || "",
    type: asset.type || "",
    vpcID: asset.vpc_id || "",
    zone: asset.zone || "",
  };
}

function trimmed(value: string) {
  return value.trim();
}

export function assetFormToCreatePayload(form: AssetFormState): CreateAssetPayload {
  const payload: CreateAssetPayload = {
    name: trimmed(form.name),
    type: trimmed(form.type),
  };
  const optional: Array<[keyof CreateAssetPayload, string]> = [
    ["account_id", form.accountID],
    ["business_unit", form.businessUnit],
    ["criticality", form.criticality],
    ["env", form.env],
    ["external_id", form.externalID],
    ["instance_type", form.instanceType],
    ["os_image", form.osImage],
    ["owner", form.owner],
    ["private_dns", form.privateDNS],
    ["private_ip", form.privateIP],
    ["public_ip", form.publicIP],
    ["region", form.region],
    ["source", form.source],
    ["status", form.status],
    ["subnet_id", form.subnetID],
    ["vpc_id", form.vpcID],
    ["zone", form.zone],
  ];
  for (const [key, value] of optional) {
    const trimmedValue = trimmed(value);
    if (trimmedValue) (payload as Record<string, unknown>)[key] = trimmedValue;
  }
  return payload;
}

export function assetFormToUpdatePayload(form: AssetFormState): UpdateAssetPayload {
  // PATCH semantics: send every editable field so the form is "what you see is
  // what is saved", including blanking optional metadata. Type and source are
  // immutable on the backend (UpdateAssetRequest has no fields for them).
  return {
    account_id: trimmed(form.accountID),
    business_unit: trimmed(form.businessUnit),
    criticality: trimmed(form.criticality),
    env: trimmed(form.env),
    instance_type: trimmed(form.instanceType),
    name: trimmed(form.name),
    os_image: trimmed(form.osImage),
    owner: trimmed(form.owner),
    private_dns: trimmed(form.privateDNS),
    private_ip: trimmed(form.privateIP),
    public_ip: trimmed(form.publicIP),
    region: trimmed(form.region),
    status: trimmed(form.status),
    subnet_id: trimmed(form.subnetID),
    vpc_id: trimmed(form.vpcID),
    zone: trimmed(form.zone),
  };
}

export function validateAssetForm(form: AssetFormState, mode: AssetFormMode): string {
  if (!trimmed(form.name)) return "Name is required.";
  if (mode === "create" && !trimmed(form.type)) return "Type is required.";
  return "";
}

export function formatAssetRange(total: number, offset: number, count: number) {
  if (total <= 0 || count <= 0) return "0 assets";

  const from = offset + 1;
  const to = Math.min(offset + count, total);

  return `${from}-${to} of ${total}`;
}

export function previousAssetOffset(offset: number, limit: number) {
  return Math.max(0, offset - limit);
}

export function nextAssetOffset(offset: number, limit: number, total: number) {
  if (limit <= 0) return offset;
  if (offset + limit >= total) return offset;

  return offset + limit;
}
