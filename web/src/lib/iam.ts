import type { IamRole, IamUser, RolePermission, Scope } from "../api/iam";

// formatScope renders a scope as the dense matrix label, e.g.
// "env=default,dev · source=aws" or "env≠prod". Empty scope == unscoped.
export function formatScope(scope: Scope | undefined): string {
  if (!scope || scope.length === 0) return "all";
  return scope
    .map((c) => {
      const op = c.op === "not_in" ? "≠" : "=";
      return `${c.dimension}${op}${c.values.join(",")}`;
    })
    .join(" · ");
}

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
