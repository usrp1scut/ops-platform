import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, RefreshCw, Search, ShieldAlert, UserPlus, UsersRound, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  bindRoleToUser,
  getIamRolePermissions,
  getIamUserIdentity,
  listIamRoles,
  listIamUsers,
  unbindRoleFromUser,
  type IamRole,
  type IamUser,
} from "../../api/iam";
import { PanelState } from "../../components/PanelState";
import { PermissionList } from "../../components/PermissionList";
import { groupRolePermissions, iamUserLabel, rolesAvailableToBind } from "../../lib/iam";
import { useAuth } from "../auth/AuthProvider";
import { CapabilityMatrix } from "./CapabilityMatrix";

type IamView = "capabilities" | "directory";

type ActionFeedback = {
  kind: "error" | "success";
  message: string;
};

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function rolePermissionCount(role: IamRole) {
  return role.permissions?.length || 0;
}

function roleNames(user: IamUser) {
  return user.roles || [];
}

export function IamPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const currentUserID = auth.identity?.user.id || "";
  const canReadIAM = auth.can("iam.user:read");
  const canWriteIAM = auth.can("iam.user:write");
  const iamPermissions = (auth.identity?.permissions || []).filter((permission) => permission.startsWith("iam.user:"));
  const [searchParams] = useSearchParams();
  // Deep link from Audit ("open this user in IAM"): /iam?user=<id>.
  // The capabilities matrix has no per-user panel, so a user deep link
  // lands on the directory view with that user pre-selected.
  const deepLinkUserID = searchParams.get("user") || "";
  const [view, setView] = useState<IamView>(deepLinkUserID ? "directory" : "capabilities");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserID, setSelectedUserID] = useState(deepLinkUserID);
  const [selectedRoleName, setSelectedRoleName] = useState("");
  const [roleToBind, setRoleToBind] = useState("");
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const iamRootKey = ["iam", currentUserID] as const;

  useEffect(() => {
    document.body.classList.add("fullwidth-mode");
    return () => {
      document.body.classList.remove("fullwidth-mode");
    };
  }, []);

  const users = useQuery({
    queryKey: [...iamRootKey, "users", userSearch.trim()],
    queryFn: () => listIamUsers({ query: userSearch }),
    enabled: canReadIAM && Boolean(currentUserID),
  });
  const roles = useQuery({
    queryKey: [...iamRootKey, "roles", "with-permissions"],
    queryFn: () => listIamRoles({ includePermissions: true }),
    enabled: canReadIAM && Boolean(currentUserID),
  });
  const selectedIdentity = useQuery({
    queryKey: [...iamRootKey, "users", "identity", selectedUserID],
    queryFn: () => getIamUserIdentity(selectedUserID),
    enabled: canReadIAM && Boolean(currentUserID) && Boolean(selectedUserID),
  });
  const selectedRolePermissions = useQuery({
    queryKey: [...iamRootKey, "roles", selectedRoleName, "permissions"],
    queryFn: () => getIamRolePermissions(selectedRoleName),
    enabled: canReadIAM && Boolean(currentUserID) && Boolean(selectedRoleName),
  });

  const userItems = users.data?.items || [];
  const roleItems = roles.data?.items || [];
  const selectedUser = selectedIdentity.data?.user || userItems.find((user) => user.id === selectedUserID);
  const selectedUserRoles = selectedIdentity.data?.roles || (selectedUser ? roleNames(selectedUser) : []);
  const availableRoles = useMemo(
    () => rolesAvailableToBind(roleItems, selectedUserRoles),
    [roleItems, selectedUserRoles],
  );
  const permissionGroups = useMemo(
    () => groupRolePermissions(selectedRolePermissions.data?.permissions || []),
    [selectedRolePermissions.data?.permissions],
  );

  const bindRole = useMutation({
    mutationFn: (roleName: string) => bindRoleToUser(selectedUserID, roleName),
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: async (_identity, roleName) => {
      setRoleToBind("");
      setFeedback({ kind: "success", message: `Role ${roleName} bound to ${iamUserLabel(selectedUser)}.` });
      await queryClient.invalidateQueries({ queryKey: iamRootKey });
    },
    onError: (error) => {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Failed to bind role." });
    },
  });

  const unbindRole = useMutation({
    mutationFn: (roleName: string) => unbindRoleFromUser(selectedUserID, roleName),
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: async (_identity, roleName) => {
      setFeedback({ kind: "success", message: `Role ${roleName} removed from ${iamUserLabel(selectedUser)}.` });
      await queryClient.invalidateQueries({ queryKey: iamRootKey });
    },
    onError: (error) => {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Failed to unbind role." });
    },
  });

  function refreshIam() {
    void users.refetch();
    void roles.refetch();
    if (selectedUserID) void selectedIdentity.refetch();
    if (selectedRoleName) void selectedRolePermissions.refetch();
  }

  function submitBindRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roleName = roleToBind.trim();

    if (!selectedUserID) {
      setFeedback({ kind: "error", message: "Select a user before binding a role." });
      return;
    }
    if (!roleName) {
      setFeedback({ kind: "error", message: "Select a role before binding." });
      return;
    }

    bindRole.mutate(roleName);
  }

  function removeRole(roleName: string) {
    if (!window.confirm(`Remove ${roleName} from ${iamUserLabel(selectedUser)}?`)) return;
    unbindRole.mutate(roleName);
  }

  const refreshing = users.isFetching || roles.isFetching;

  return (
    <section className="page-section iam-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Identity</p>
          <h1>IAM</h1>
        </div>
        <span className={`status-pill ${canReadIAM ? "ok" : "warn"}`}>
          <ShieldAlert size={14} aria-hidden="true" />
          {canReadIAM ? "iam.user:read" : "Needs iam.user:read"}
        </span>
      </div>

      <div className="iam-toolbar">
        <div className="iam-toolbar-stats">
          <span className="iam-stat">
            <UsersRound size={14} aria-hidden="true" />
            <strong>{canReadIAM ? userItems.length : "-"}</strong>
            <span className="muted">users</span>
          </span>
          <span className="iam-stat">
            <KeyRound size={14} aria-hidden="true" />
            <strong>{canReadIAM ? roleItems.length : "-"}</strong>
            <span className="muted">roles</span>
          </span>
          <span className="iam-stat">
            <CheckCircle2 size={14} aria-hidden="true" />
            <strong>{iamPermissions.length}</strong>
            <span className="muted">my permissions · {canWriteIAM ? "write" : "read"}</span>
          </span>
        </div>
        <div className="iam-toolbar-actions">
          <div className="iam-view-switch" role="tablist" aria-label="IAM view">
            <button
              type="button"
              role="tab"
              aria-selected={view === "capabilities"}
              className={view === "capabilities" ? "active" : ""}
              onClick={() => setView("capabilities")}
            >
              Capabilities
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "directory"}
              className={view === "directory" ? "active" : ""}
              onClick={() => setView("directory")}
            >
              Users &amp; roles
            </button>
          </div>
          {view === "directory" ? (
            <button
              type="button"
              className="secondary-button compact"
              onClick={refreshIam}
              disabled={!canReadIAM || refreshing}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>{refreshing ? "Refreshing" : "Refresh"}</span>
            </button>
          ) : null}
        </div>
      </div>

      {view === "capabilities" ? <CapabilityMatrix /> : null}

      {view === "directory" ? (
        <>
      <div className="profile-grid">
        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Users</p>
              <h2>Users</h2>
            </div>
            <span className="status-pill">{userItems.length}</span>
          </div>

          {!canReadIAM ? <PanelState kind="permission" message="Permission required: iam.user:read" /> : null}

          {canReadIAM && users.isError ? (
            <PanelState
              kind="error"
              message={users.error instanceof Error ? users.error.message : "Failed to load IAM users."}
            />
          ) : null}

          <label className="form-field search-field">
            <span>Search</span>
            <div className="input-with-icon">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Name, email, subject"
                disabled={!canReadIAM}
              />
            </div>
          </label>

          {canReadIAM && users.isLoading ? <PanelState kind="loading" message="Loading IAM users" /> : null}

          {canReadIAM && !users.isLoading && !users.isError && userItems.length === 0 ? (
            <PanelState kind="empty" message="No IAM users match this search." />
          ) : null}

          {userItems.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Roles</th>
                    <th>Last login</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {userItems.map((user) => (
                    <tr className={selectedUserID === user.id ? "selected" : ""} key={user.id}>
                      <td>
                        <strong>{iamUserLabel(user)}</strong>
                        <div className="muted">{user.email || user.oidc_subject || user.id}</div>
                      </td>
                      <td>
                        <div className="chip-list">
                          {roleNames(user).length > 0 ? (
                            roleNames(user).map((role) => (
                              <span className="chip" key={role}>
                                {role}
                              </span>
                            ))
                          ) : (
                            <span className="muted">none</span>
                          )}
                        </div>
                      </td>
                      <td>{formatDateTime(user.last_login_at)}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary-button compact"
                          onClick={() => {
                            setSelectedUserID(user.id);
                            setFeedback(null);
                          }}
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">User roles</p>
              <h2>{selectedUser ? iamUserLabel(selectedUser) : "Selected user"}</h2>
            </div>
            <span className="status-pill">{selectedUserRoles.length}</span>
          </div>

          {feedback ? <PanelState kind={feedback.kind} message={feedback.message} /> : null}

          {!selectedUserID ? <PanelState kind="empty" message="No user selected." /> : null}

          {selectedUserID && selectedIdentity.isLoading ? (
            <PanelState kind="loading" message="Loading selected user" />
          ) : null}

          {selectedUserID && selectedIdentity.isError ? (
            <PanelState
              kind="error"
              message={
                selectedIdentity.error instanceof Error
                  ? selectedIdentity.error.message
                  : "Failed to load selected user."
              }
            />
          ) : null}

          {selectedUser ? (
            <>
              <dl className="detail-list">
                <div>
                  <dt>ID</dt>
                  <dd>
                    <code>{selectedUser.id}</code>
                  </dd>
                </div>
                <div>
                  <dt>Subject</dt>
                  <dd>{selectedUser.oidc_subject || "-"}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{selectedUser.email || "-"}</dd>
                </div>
                <div>
                  <dt>Last login</dt>
                  <dd>{formatDateTime(selectedUser.last_login_at)}</dd>
                </div>
              </dl>

              <div className="chip-list role-chip-list">
                {selectedUserRoles.length > 0 ? (
                  selectedUserRoles.map((role) => (
                    <span className="chip role-chip" key={role}>
                      {role}
                      {canWriteIAM ? (
                        <button
                          type="button"
                          className="chip-icon-button"
                          onClick={() => removeRole(role)}
                          disabled={unbindRole.isPending}
                          title={`Unbind ${role}`}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  ))
                ) : (
                  <span className="muted">No role bindings.</span>
                )}
              </div>

              {!canWriteIAM ? <PanelState kind="permission" message="Permission required: iam.user:write" /> : null}

              <form className="role-bind-form" onSubmit={submitBindRole}>
                <label className="form-field">
                  <span>Role</span>
                  <select
                    value={roleToBind}
                    onChange={(event) => setRoleToBind(event.target.value)}
                    disabled={!canWriteIAM || bindRole.isPending || availableRoles.length === 0}
                  >
                    <option value="">Select role</option>
                    {availableRoles.map((role) => (
                      <option value={role.name} key={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={!canWriteIAM || !roleToBind || !selectedUserID || bindRole.isPending}
                >
                  <UserPlus size={16} aria-hidden="true" />
                  <span>{bindRole.isPending ? "Binding" : "Bind role"}</span>
                </button>
              </form>

              {canWriteIAM && availableRoles.length === 0 ? (
                <PanelState kind="empty" message="All roles are already bound." />
              ) : null}
            </>
          ) : null}
        </article>
      </div>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Roles</p>
            <h2>Role permissions</h2>
          </div>
          <span className="status-pill">{roleItems.length}</span>
        </div>

        {canReadIAM && roles.isError ? (
          <PanelState
            kind="error"
            message={roles.error instanceof Error ? roles.error.message : "Failed to load IAM roles."}
          />
        ) : null}

        {canReadIAM && roles.isLoading ? <PanelState kind="loading" message="Loading IAM roles" /> : null}

        {canReadIAM && !roles.isLoading && !roles.isError && roleItems.length === 0 ? (
          <PanelState kind="empty" message="No roles configured." />
        ) : null}

        {roleItems.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Description</th>
                  <th>Permissions</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {roleItems.map((role) => (
                  <tr className={selectedRoleName === role.name ? "selected" : ""} key={role.id}>
                    <td>
                      <strong>{role.name}</strong>
                    </td>
                    <td>{role.description || "-"}</td>
                    <td>{rolePermissionCount(role)}</td>
                    <td>{formatDateTime(role.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => setSelectedRoleName(role.name)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {!selectedRoleName ? <PanelState kind="empty" message="No role selected." /> : null}

        {selectedRoleName && selectedRolePermissions.isLoading ? (
          <PanelState kind="loading" message="Loading role permissions" />
        ) : null}

        {selectedRoleName && selectedRolePermissions.isError ? (
          <PanelState
            kind="error"
            message={
              selectedRolePermissions.error instanceof Error
                ? selectedRolePermissions.error.message
                : "Failed to load role permissions."
            }
          />
        ) : null}

        {selectedRoleName &&
        !selectedRolePermissions.isLoading &&
        !selectedRolePermissions.isError &&
        permissionGroups.length === 0 ? (
          <PanelState kind="empty" message="No permissions assigned to this role." />
        ) : null}

        {permissionGroups.length > 0 ? (
          <div className="request-list">
            {permissionGroups.map((group) => (
              <article className="request-row" key={group.resource}>
                <div className="request-main">
                  <div>
                    <h3>{group.resource}</h3>
                    <p>{group.actions.join(", ") || "-"}</p>
                  </div>
                  <span className="status-pill">{group.permissions.length}</span>
                </div>
                <div className="chip-list">
                  {group.permissions.map((permission) => (
                    <span className="chip permission" key={permission}>
                      <CheckCircle2 size={14} aria-hidden="true" />
                      {permission}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </article>

      <details className="iam-perms-summary">
        <summary>
          Effective IAM permissions
          <span className="muted"> — {iamPermissions.length} grant{iamPermissions.length === 1 ? "" : "s"}</span>
        </summary>
        <PermissionList permissions={iamPermissions} emptyLabel="No IAM permissions." />
      </details>
        </>
      ) : null}
    </section>
  );
}
