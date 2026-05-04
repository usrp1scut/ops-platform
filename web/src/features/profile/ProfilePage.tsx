import { RefreshCw, UserRound } from "lucide-react";
import { useState } from "react";

import { PermissionList } from "../../components/PermissionList";
import { useAuth } from "../auth/AuthProvider";

export function ProfilePage() {
  const auth = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const user = auth.identity?.user;

  async function refresh() {
    try {
      setRefreshing(true);
      await auth.refreshProfile();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>{user?.name || user?.email || user?.oidc_subject || "Operator"}</h1>
        </div>
        <button type="button" className="secondary-button compact" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{refreshing ? "Refreshing" : "Refresh"}</span>
        </button>
      </div>

      <div className="profile-grid">
        <article className="work-panel">
          <div className="profile-heading">
            <div className="metric-icon">
              <UserRound size={20} aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow">Identity</p>
              <h2>{user?.email || user?.oidc_subject || "Unknown user"}</h2>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>User ID</dt>
              <dd>{user?.id || "-"}</dd>
            </div>
            <div>
              <dt>OIDC subject</dt>
              <dd>{user?.oidc_subject || "-"}</dd>
            </div>
            <div>
              <dt>Last login</dt>
              <dd>{user?.last_login_at ? new Date(user.last_login_at).toLocaleString() : "-"}</dd>
            </div>
          </dl>
        </article>

        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Access</p>
              <h2>Roles</h2>
            </div>
            <span className="status-pill">{auth.identity?.roles.length || 0}</span>
          </div>
        <div className="chip-list">
          {(auth.identity?.roles || []).map((role) => (
            <span className="chip" key={role}>
                {role}
              </span>
            ))}
            {!auth.identity?.roles.length ? <span className="muted">No roles.</span> : null}
          </div>
        </article>
      </div>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">RBAC</p>
            <h2>Effective permissions</h2>
          </div>
          <span className="status-pill">{auth.identity?.permissions.length || 0}</span>
        </div>
        <PermissionList permissions={auth.identity?.permissions || []} emptyLabel="No permissions." />
      </article>
    </section>
  );
}
