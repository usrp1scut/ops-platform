import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import {
  CheckCircle2,
  Clock,
  Database,
  Inbox,
  KeyRound,
  Loader2,
  RefreshCw,
  SquareTerminal,
  Wifi,
} from "lucide-react";
import { Link } from "react-router-dom";

import { listAssets } from "../../api/cmdb";
import { listMyActiveBastionGrants, listPendingBastionRequests } from "../../api/bastion";
import { listSessions } from "../../api/sessions";
import { getHealth } from "../../api/health";
import { formatGrantTimeRemaining } from "../../lib/bastionGrants";
import { buildAuditSearch } from "../../lib/launch";
import { sessionCounts, sessionStatus, sessionStatusTone } from "../../lib/sessions";
import { useAuth } from "../auth/AuthProvider";

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`status-pill ${ok ? "ok" : "warn"}`}>{label}</span>;
}

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

// A metric tile that degrades to an explicit "no access" / "…" state per
// permission instead of erroring, so one missing grant never blanks the
// whole dashboard.
function MetricCard({
  icon,
  label,
  value,
  pill,
  pillOk = true,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  pill: string;
  pillOk?: boolean;
}) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
      </div>
      <StatusPill ok={pillOk} label={pill} />
    </article>
  );
}

export function OverviewPage() {
  const auth = useAuth();
  const userID = auth.identity?.user.id || "";
  const canReadAssets = auth.can("cmdb.asset:read");
  const canReadAllSessions = auth.can("bastion.session:read");
  const canReadGrants = auth.can("bastion.grant:read");
  const canReadRequests = auth.can("bastion.request:read");
  // Backend self-scopes the pending-requests list; only grant:write/admin
  // see everyone's. Mirror that here so the label never overstates.
  const seesAllRequests = auth.can("bastion.grant:write");

  // The dashboard is a wide grid + two-column panel row; opt into the
  // fullwidth shell (same as Connect/CMDB/IAM) so it uses the screen
  // instead of the centered page cap.
  useEffect(() => {
    document.body.classList.add("fullwidth-mode");
    return () => {
      document.body.classList.remove("fullwidth-mode");
    };
  }, []);

  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 30000,
  });
  const assets = useQuery({
    queryKey: ["cmdb", "assets", "overview-total", userID],
    queryFn: () => listAssets({ limit: 1 }),
    enabled: canReadAssets && Boolean(userID),
  });
  const sessions = useQuery({
    queryKey: ["sessions", "overview", userID],
    queryFn: () => listSessions({ limit: 100 }),
    enabled: canReadAssets && Boolean(userID),
    refetchInterval: 30000,
  });
  const grants = useQuery({
    queryKey: ["bastion", "grants", "active", "mine", userID],
    queryFn: () => listMyActiveBastionGrants(userID, 50),
    enabled: canReadGrants && Boolean(userID),
  });
  const requests = useQuery({
    queryKey: ["bastion", "requests", "pending", "overview", userID],
    queryFn: () => listPendingBastionRequests(100),
    enabled: canReadRequests && Boolean(userID),
  });

  const healthOk = health.data?.status === "ok";
  const displayName =
    auth.identity?.user.name || auth.identity?.user.email || auth.identity?.user.oidc_subject || "Operator";

  const sessionItems = sessions.data?.items || [];
  const counts = sessionCounts(sessionItems);
  const recentSessions = sessionItems.slice(0, 5);
  const grantItems = grants.data?.items || [];
  const soonestGrantExpiry = grantItems
    .filter((grant) => grant.active)
    .map((grant) => grant.expires_at)
    .sort()[0];
  const pendingCount = requests.data?.items.length ?? 0;

  function refreshAll() {
    void health.refetch();
    if (canReadAssets) {
      void assets.refetch();
      void sessions.refetch();
    }
    if (canReadGrants) void grants.refetch();
    if (canReadRequests) void requests.refetch();
  }

  const refreshing =
    health.isFetching ||
    assets.isFetching ||
    sessions.isFetching ||
    grants.isFetching ||
    requests.isFetching;

  function metricValue(enabled: boolean, query: { isLoading: boolean }, node: ReactNode) {
    if (!enabled) return "—";
    if (query.isLoading) return "…";
    return node;
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Good to see you, {displayName}</h1>
        </div>
        <button type="button" className="secondary-button compact" onClick={refreshAll} disabled={refreshing}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>{refreshing ? "Refreshing" : "Refresh"}</span>
        </button>
      </div>

      <div className="metric-grid">
        <MetricCard
          icon={health.isFetching ? <Loader2 size={20} aria-hidden="true" /> : <Wifi size={20} aria-hidden="true" />}
          label="API health"
          value={healthOk ? "Online" : "Unavailable"}
          pill={healthOk ? "ok" : "check"}
          pillOk={healthOk}
        />

        <MetricCard
          icon={<Database size={20} aria-hidden="true" />}
          label="Assets"
          value={metricValue(canReadAssets, assets, assets.data?.total ?? 0)}
          pill={canReadAssets ? "inventory" : "no access"}
          pillOk={canReadAssets}
        />

        <MetricCard
          icon={<SquareTerminal size={20} aria-hidden="true" />}
          label={canReadAllSessions ? "Active sessions" : "Active sessions (yours)"}
          value={metricValue(canReadAssets, sessions, counts.active)}
          pill={canReadAssets ? `${counts.total} loaded` : "no access"}
          pillOk={canReadAssets}
        />

        <MetricCard
          icon={<KeyRound size={20} aria-hidden="true" />}
          label="My active grants"
          value={metricValue(canReadGrants, grants, grantItems.filter((g) => g.active).length)}
          pill={
            !canReadGrants
              ? "no access"
              : soonestGrantExpiry
                ? `next ${formatGrantTimeRemaining(soonestGrantExpiry)}`
                : "none"
          }
          pillOk={canReadGrants}
        />

        <MetricCard
          icon={<Inbox size={20} aria-hidden="true" />}
          label={seesAllRequests ? "Pending requests" : "Pending requests (yours)"}
          value={metricValue(canReadRequests, requests, pendingCount)}
          pill={canReadRequests ? (pendingCount > 0 ? "needs review" : "clear") : "no access"}
          pillOk={canReadRequests && pendingCount === 0}
        />
      </div>

      <div className="profile-grid">
        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Operate</p>
              <h2>Recent activity</h2>
            </div>
            <Link className="secondary-button compact" to="/audit">
              Open Audit →
            </Link>
          </div>

          {!canReadAssets ? (
            <p className="muted">Permission required: cmdb.asset:read</p>
          ) : (
            <>
              {!canReadAllSessions ? (
                <p className="muted">Showing only your own sessions.</p>
              ) : null}
              {sessions.isLoading ? (
                <p className="muted">Loading…</p>
              ) : recentSessions.length === 0 ? (
                <p className="muted">No recent sessions.</p>
              ) : (
                <ul className="overview-activity">
                  {recentSessions.map((session) => (
                    <li key={session.id}>
                      <span className="overview-activity-when">{formatDateTime(session.started_at)}</span>
                      <span className="overview-activity-who">{session.user_name || session.user_id}</span>
                      <Link
                        className="table-link overview-activity-asset"
                        to={`/audit${buildAuditSearch({ assetID: session.asset_id })}`}
                        title="Filter audit to this asset"
                      >
                        {session.asset_name || session.asset_id}
                      </Link>
                      <span className={`status-pill ${sessionStatusTone(session)}`}>
                        {sessionStatus(session)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </article>

        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Console</p>
              <h2>Platform status</h2>
            </div>
            <StatusPill ok={healthOk} label={healthOk ? "operational" : "degraded"} />
          </div>
          <div className="check-list">
            <div>
              <CheckCircle2 size={14} aria-hidden="true" /> React/Vite console served standalone; ops-api is API-only
            </div>
            <div>
              <Clock size={14} aria-hidden="true" /> API {healthOk ? "online" : "unavailable"} — re-checked every 30s
            </div>
            <div>
              <CheckCircle2 size={14} aria-hidden="true" /> Signed in as {displayName} ·{" "}
              {auth.identity?.roles.length || 0} role
              {(auth.identity?.roles.length || 0) === 1 ? "" : "s"} ·{" "}
              {auth.identity?.permissions.length || 0} permission grant
              {(auth.identity?.permissions.length || 0) === 1 ? "" : "s"}
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
