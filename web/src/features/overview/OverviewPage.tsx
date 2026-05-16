import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RefreshCw, Wifi } from "lucide-react";

import { getHealth } from "../../api/health";
import { useAuth } from "../auth/AuthProvider";

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`status-pill ${ok ? "ok" : "warn"}`}>{label}</span>;
}

export function OverviewPage() {
  const auth = useAuth();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 30000,
  });

  const healthOk = health.data?.status === "ok";
  const displayName =
    auth.identity?.user.name || auth.identity?.user.email || auth.identity?.user.oidc_subject || "Operator";

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Good to see you, {displayName}</h1>
        </div>
        <button type="button" className="secondary-button compact" onClick={() => void health.refetch()}>
          <RefreshCw size={16} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-icon">
            {health.isFetching ? <Loader2 size={20} aria-hidden="true" /> : <Wifi size={20} aria-hidden="true" />}
          </div>
          <div>
            <div className="metric-label">API health</div>
            <div className="metric-value">{healthOk ? "Online" : "Unavailable"}</div>
          </div>
          <StatusPill ok={healthOk} label={healthOk ? "ok" : "check"} />
        </article>

        <article className="metric-card">
          <div className="metric-icon">
            <CheckCircle2 size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Identity</div>
            <div className="metric-value">{auth.identity?.roles.length || 0} roles</div>
          </div>
          <StatusPill ok={Boolean(auth.identity)} label={auth.identity ? "ready" : "missing"} />
        </article>

        <article className="metric-card">
          <div className="metric-icon">
            <CheckCircle2 size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Permissions</div>
            <div className="metric-value">{auth.identity?.permissions.length || 0} grants</div>
          </div>
          <StatusPill ok={Boolean(auth.identity?.permissions.length)} label="ux hints" />
        </article>
      </div>

      <div className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Console</p>
            <h2>Platform status</h2>
          </div>
          <StatusPill ok={healthOk} label={healthOk ? "operational" : "degraded"} />
        </div>
        <div className="check-list">
          <div>React/Vite console served standalone; ops-api is API-only</div>
          <div>API {healthOk ? "online" : "unavailable"} — re-checked every 30s</div>
          <div>
            Signed in as {displayName} · {auth.identity?.roles.length || 0} role
            {(auth.identity?.roles.length || 0) === 1 ? "" : "s"} ·{" "}
            {auth.identity?.permissions.length || 0} permission grant
            {(auth.identity?.permissions.length || 0) === 1 ? "" : "s"}
          </div>
        </div>
      </div>
    </section>
  );
}
