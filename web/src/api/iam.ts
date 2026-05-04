import { apiRequest } from "./client";

export type IamUser = {
  id: string;
  oidc_subject: string;
  email?: string;
  name?: string;
  created_at: string;
  updated_at: string;
  last_login_at: string;
  roles?: string[];
};

export type RolePermission = {
  action: string;
  permission: string;
  resource: string;
};

export type IamRole = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  permissions?: RolePermission[];
};

export type IamUserIdentity = {
  user: IamUser;
  roles: string[];
  permissions: string[];
};

export type ListIamUsersOptions = {
  query?: string;
};

export type ListIamUsersResponse = {
  items: IamUser[];
};

export type ListIamRolesOptions = {
  includePermissions?: boolean;
};

export type ListIamRolesResponse = {
  items: IamRole[];
};

export type RolePermissionsResponse = {
  role_name: string;
  permissions: RolePermission[];
};

export function buildIamUsersQuery(options: ListIamUsersOptions = {}) {
  const params = new URLSearchParams();
  const query = options.query?.trim();

  if (query) params.set("q", query);

  return params.toString();
}

export function buildIamRolesQuery(options: ListIamRolesOptions = {}) {
  const params = new URLSearchParams();

  if (options.includePermissions) params.set("include_permissions", "true");

  return params.toString();
}

export function buildIamUserPath(userID: string) {
  return `/api/v1/iam/users/${encodeURIComponent(userID)}`;
}

export function buildIamUserRolesPath(userID: string) {
  return `${buildIamUserPath(userID)}/roles`;
}

export function buildIamUserRolePath(userID: string, roleName: string) {
  return `${buildIamUserRolesPath(userID)}/${encodeURIComponent(roleName)}`;
}

export function buildIamRolePermissionsPath(roleName: string) {
  return `/api/v1/iam/roles/${encodeURIComponent(roleName)}/permissions`;
}

export function listIamUsers(options: ListIamUsersOptions = {}) {
  const params = buildIamUsersQuery(options);
  const path = params ? `/api/v1/iam/users?${params}` : "/api/v1/iam/users";

  return apiRequest<ListIamUsersResponse>(path);
}

export function getIamUserIdentity(userID: string) {
  return apiRequest<IamUserIdentity>(buildIamUserPath(userID));
}

export function listIamRoles(options: ListIamRolesOptions = {}) {
  const params = buildIamRolesQuery(options);
  const path = params ? `/api/v1/iam/roles?${params}` : "/api/v1/iam/roles";

  return apiRequest<ListIamRolesResponse>(path);
}

export function getIamRolePermissions(roleName: string) {
  return apiRequest<RolePermissionsResponse>(buildIamRolePermissionsPath(roleName));
}

export function bindRoleToUser(userID: string, roleName: string) {
  return apiRequest<IamUserIdentity>(buildIamUserRolesPath(userID), {
    method: "POST",
    body: JSON.stringify({ role_name: roleName }),
  });
}

export function unbindRoleFromUser(userID: string, roleName: string) {
  return apiRequest<IamUserIdentity>(buildIamUserRolePath(userID, roleName), {
    method: "DELETE",
  });
}
