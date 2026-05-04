import type { IamRole, IamUser, RolePermission } from "../api/iam";

export type PermissionGroup = {
  actions: string[];
  permissions: string[];
  resource: string;
};

export function iamUserLabel(user: IamUser | undefined) {
  if (!user) return "Unknown user";
  return user.name || user.email || user.oidc_subject || user.id;
}

export function rolesAvailableToBind(roles: IamRole[], assignedRoles: readonly string[]) {
  const assigned = new Set(assignedRoles);
  return roles.filter((role) => !assigned.has(role.name));
}

export function groupRolePermissions(permissions: RolePermission[]) {
  const groups = new Map<string, PermissionGroup>();

  for (const permission of permissions) {
    const resource = permission.resource || "unknown";
    const group = groups.get(resource) || { actions: [], permissions: [], resource };
    if (permission.action && !group.actions.includes(permission.action)) {
      group.actions.push(permission.action);
    }
    if (permission.permission && !group.permissions.includes(permission.permission)) {
      group.permissions.push(permission.permission);
    }
    groups.set(resource, group);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      actions: group.actions.sort(),
      permissions: group.permissions.sort(),
    }))
    .sort((left, right) => left.resource.localeCompare(right.resource));
}
