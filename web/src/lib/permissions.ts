export const knownPermissions = [
  "system:admin",
  "cmdb.asset:read",
  "cmdb.asset:write",
  "aws.account:read",
  "aws.account:write",
  "iam.user:read",
  "iam.user:write",
  "bastion.grant:read",
  "bastion.grant:write",
  "bastion.request:read",
  "bastion.request:write",
  "bastion.session:connect",
  "bastion.session:read",
] as const;

export type KnownPermission = (typeof knownPermissions)[number];

export function hasPermission(granted: readonly string[] | undefined, permission: string) {
  if (!granted) return false;
  return granted.includes("system:admin") || granted.includes(permission);
}

export function createPermissionChecker(granted: readonly string[] | undefined) {
  return (permission: string) => hasPermission(granted, permission);
}
