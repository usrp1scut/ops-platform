import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, MonitorPlay, RefreshCw, Search, ShieldCheck, SquareTerminal, Timer, Video } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { getSessionRecording, listSessions, type SessionAuditRecord } from "../../api/sessions";
import { PanelState } from "../../components/PanelState";
import { PermissionList } from "../../components/PermissionList";
import { buildAuditSearch } from "../../lib/launch";
import {
  filterSessionsByStatus,
  formatBytes,
  formatDurationMs,
  parseAsciicast,
  recordingLabel,
  sessionCounts,
  sessionStatus,
  sessionStatusTone,
  type RecordingPreview,
  type SessionFilters,
  type SessionStatusFilter,
} from "../../lib/sessions";
import { useAuth } from "../auth/AuthProvider";

type ActionFeedback = {
  kind: "error" | "success";
  message: string;
};

type RecordingPreviewState = {
  label: string;
  preview: RecordingPreview;
  rawText: string;
  sessionID: string;
};

const emptyFilters: SessionFilters = {
  assetID: "",
  status: "all",
  userID: "",
};

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function updateFilter<K extends keyof SessionFilters>(
  setFilters: (updater: (current: SessionFilters) => SessionFilters) => void,
  key: K,
  value: SessionFilters[K],
) {
  setFilters((current) => ({ ...current, [key]: value }));
}

function trafficLabel(session: SessionAuditRecord) {
  return `${formatBytes(session.bytes_in)} / ${formatBytes(session.bytes_out)}`;
}

function downloadRecording(sessionID: string, rawText: string) {
  const blob = new Blob([rawText], { type: "application/x-asciicast" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sessionID}.cast`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AuditPage() {
  const auth = useAuth();
  const userID = auth.identity?.user.id || "";
  const permissions = auth.identity?.permissions || [];
  const canReadSessions = auth.can("cmdb.asset:read");
  const canReadAllSessions = auth.can("bastion.session:read");
  const sessionPermissions = permissions.filter(
    (permission) =>
      permission === "system:admin" || permission === "cmdb.asset:read" || permission === "bastion.session:read",
  );
  const [filters, setFilters] = useState<SessionFilters>(emptyFilters);
  const [draftFilters, setDraftFilters] = useState<SessionFilters>(emptyFilters);
  const [searchParams] = useSearchParams();
  // Seed (and re-seed on navigation) the filters from the URL so other
  // pages can deep-link into a pre-filtered audit view, e.g.
  // /audit?asset=<id> from a live session or ?user=<id> from IAM.
  // Manual filter edits don't touch the URL, so this only fires on an
  // actual navigation and never clobbers a user's in-page changes.
  useEffect(() => {
    const asset = searchParams.get("asset");
    const user = searchParams.get("user");
    const statusParam = searchParams.get("status");
    if (asset === null && user === null && statusParam === null) return;
    const status: SessionStatusFilter =
      statusParam === "active" || statusParam === "closed" || statusParam === "error"
        ? statusParam
        : "all";
    const next: SessionFilters = { assetID: asset || "", status, userID: user || "" };
    setFilters(next);
    setDraftFilters(next);
  }, [searchParams]);
  const [recordingFeedback, setRecordingFeedback] = useState<ActionFeedback | null>(null);
  const [recordingPreview, setRecordingPreview] = useState<RecordingPreviewState | null>(null);
  const effectiveUserID = canReadAllSessions ? filters.userID.trim() : "";
  const effectiveAssetID = filters.assetID.trim();
  const sessions = useQuery({
    queryKey: ["sessions", userID, effectiveUserID, effectiveAssetID, filters.status],
    queryFn: () =>
      listSessions({
        assetID: effectiveAssetID || undefined,
        limit: 100,
        userID: effectiveUserID || undefined,
      }),
    enabled: canReadSessions && Boolean(userID),
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
  });
  const sessionItems = sessions.data?.items || [];
  const counts = sessionCounts(sessionItems);
  const visibleSessions = useMemo(
    () => filterSessionsByStatus(sessionItems, filters.status),
    [filters.status, sessionItems],
  );
  const inspectRecording = useMutation({
    mutationFn: async (session: SessionAuditRecord) => {
      const rawText = await getSessionRecording(session.id);
      return {
        label: recordingLabel(session),
        preview: parseAsciicast(rawText),
        rawText,
        sessionID: session.id,
      };
    },
    onMutate: () => {
      setRecordingFeedback(null);
    },
    onSuccess: (preview) => {
      setRecordingPreview(preview);
      setRecordingFeedback({ kind: "success", message: `Recording loaded for ${preview.label}.` });
    },
    onError: (error) => {
      setRecordingFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to load recording.",
      });
    },
  });

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({
      assetID: draftFilters.assetID.trim(),
      status: draftFilters.status,
      userID: canReadAllSessions ? draftFilters.userID.trim() : "",
    });
  }

  function resetFilters() {
    setDraftFilters(emptyFilters);
    setFilters(emptyFilters);
  }

  return (
    <section className="page-section audit-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Govern</p>
          <h1>Audit</h1>
        </div>
        <span className={`status-pill ${canReadSessions ? "ok" : "warn"}`} title="Required permission">
          <ShieldCheck size={14} aria-hidden="true" />
          {canReadAllSessions ? "all sessions" : canReadSessions ? "own sessions" : "no access"}
        </span>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-icon">
            <SquareTerminal size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Shown</div>
            <div className="metric-value">{canReadSessions ? visibleSessions.length : "-"}</div>
          </div>
          <span className="status-pill">{counts.total} loaded</span>
        </article>

        <article className="metric-card">
          <div className="metric-icon">
            <Timer size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Active now</div>
            <div className="metric-value">{canReadSessions ? counts.active : "-"}</div>
          </div>
          <span className="status-pill">{counts.closed} closed</span>
        </article>

        <article className="metric-card">
          <div className="metric-icon">
            <Video size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Recordings</div>
            <div className="metric-value">{canReadSessions ? counts.recordings : "-"}</div>
          </div>
          <span className={`status-pill ${counts.errors > 0 ? "warn" : "ok"}`}>{counts.errors} errors</span>
        </article>
      </div>

      <div className="profile-grid">
        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Audit</p>
              <h2>Session filters</h2>
            </div>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => void sessions.refetch()}
              disabled={!canReadSessions || sessions.isFetching}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>{sessions.isFetching ? "Refreshing" : "Refresh"}</span>
            </button>
          </div>

          {!canReadSessions ? <PanelState kind="permission" message="Permission required: cmdb.asset:read" /> : null}
          {canReadSessions && !canReadAllSessions ? (
            <PanelState kind="permission" message="Showing only your own session rows." />
          ) : null}

          <form className="request-form" onSubmit={applyFilters}>
            <div className="form-grid">
              <label className="form-field">
                <span>User ID</span>
                <input
                  value={draftFilters.userID}
                  onChange={(event) => updateFilter(setDraftFilters, "userID", event.target.value)}
                  placeholder={canReadAllSessions ? "Filter by user UUID" : "Own sessions only"}
                  disabled={!canReadSessions || !canReadAllSessions}
                />
              </label>

              <label className="form-field">
                <span>Asset ID</span>
                <input
                  value={draftFilters.assetID}
                  onChange={(event) => updateFilter(setDraftFilters, "assetID", event.target.value)}
                  placeholder="Filter by asset UUID"
                  disabled={!canReadSessions}
                />
              </label>

              <label className="form-field">
                <span>Status</span>
                <select
                  value={draftFilters.status}
                  onChange={(event) =>
                    updateFilter(setDraftFilters, "status", event.target.value as SessionStatusFilter)
                  }
                  disabled={!canReadSessions}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                  <option value="error">Error</option>
                </select>
              </label>
            </div>

            <div className="form-actions">
              <button type="submit" className="primary-button" disabled={!canReadSessions}>
                <Search size={16} aria-hidden="true" />
                <span>Apply filters</span>
              </button>
              <button type="button" className="secondary-button" onClick={resetFilters} disabled={!canReadSessions}>
                Reset
              </button>
            </div>
          </form>
        </article>

        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Permissions</p>
              <h2>Session visibility</h2>
            </div>
            <span className={`status-pill ${canReadAllSessions ? "ok" : "info"}`}>
              {canReadAllSessions ? "all sessions" : "own sessions"}
            </span>
          </div>
          <PermissionList permissions={sessionPermissions} emptyLabel="No session permissions." />
        </article>
      </div>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Audit</p>
            <h2>Session records</h2>
          </div>
          <span className="status-pill">auto refresh 10s</span>
        </div>

        {recordingFeedback ? <PanelState kind={recordingFeedback.kind} message={recordingFeedback.message} /> : null}

        {canReadSessions && sessions.isError ? (
          <PanelState
            kind="error"
            message={sessions.error instanceof Error ? sessions.error.message : "Failed to load sessions."}
          />
        ) : null}

        {canReadSessions && sessions.isLoading ? <PanelState kind="loading" message="Loading sessions" /> : null}

        {canReadSessions && !sessions.isLoading && !sessions.isError && visibleSessions.length === 0 ? (
          <PanelState kind="empty" message="No sessions match the current filters." />
        ) : null}

        {visibleSessions.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>User</th>
                  <th>Asset</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>In / Out</th>
                  <th>Client IP</th>
                  <th>Recording</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {visibleSessions.map((session) => (
                  <tr key={session.id}>
                    <td>
                      <strong>{formatDateTime(session.started_at)}</strong>
                      {session.ended_at ? <div className="muted">ended {formatDateTime(session.ended_at)}</div> : null}
                    </td>
                    <td>
                      {session.user_id ? (
                        <Link
                          className="table-link"
                          to={`/iam?user=${encodeURIComponent(session.user_id)}`}
                          title="Open this user in IAM"
                        >
                          <strong>{session.user_name || session.user_id}</strong>
                        </Link>
                      ) : (
                        <strong>{session.user_name || session.user_id}</strong>
                      )}
                      <div className="muted">{session.user_id}</div>
                    </td>
                    <td>
                      {session.asset_id ? (
                        <Link
                          className="table-link"
                          to={`/audit${buildAuditSearch({ assetID: session.asset_id })}`}
                          title="Filter audit to this asset"
                        >
                          <strong>{session.asset_name || session.asset_id}</strong>
                        </Link>
                      ) : (
                        <strong>{session.asset_name || session.asset_id}</strong>
                      )}
                      <div className="muted">{session.asset_id}</div>
                      {session.proxy_name ? <div className="muted">via {session.proxy_name}</div> : null}
                    </td>
                    <td>
                      <span className={`status-pill ${sessionStatusTone(session)}`}>
                        {sessionStatus(session)}
                        {session.exit_code !== undefined && session.exit_code !== null ? ` ${session.exit_code}` : ""}
                      </span>
                    </td>
                    <td>{formatDurationMs(session.duration_ms)}</td>
                    <td>{trafficLabel(session)}</td>
                    <td>{session.client_ip || "-"}</td>
                    <td>
                      {session.has_recording ? (
                        <button
                          type="button"
                          className="secondary-button compact"
                          onClick={() => inspectRecording.mutate(session)}
                          disabled={inspectRecording.isPending}
                        >
                          <MonitorPlay size={14} aria-hidden="true" />
                          <span>{inspectRecording.isPending ? "Loading" : "Inspect"}</span>
                        </button>
                      ) : (
                        <span className="muted">none</span>
                      )}
                    </td>
                    <td>
                      {session.error ? <span className="inline-error">{session.error}</span> : <span className="muted">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      {recordingPreview ? (
        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Recording</p>
              <h2>{recordingPreview.label}</h2>
            </div>
            <div className="request-actions">
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => downloadRecording(recordingPreview.sessionID, recordingPreview.rawText)}
              >
                <Download size={14} aria-hidden="true" />
                <span>Download cast</span>
              </button>
              <button type="button" className="secondary-button compact" onClick={() => setRecordingPreview(null)}>
                Close
              </button>
            </div>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>Version</dt>
              <dd>{recordingPreview.preview.version}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>
                {recordingPreview.preview.cols} x {recordingPreview.preview.rows}
              </dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{recordingPreview.preview.durationSeconds.toFixed(1)}s</dd>
            </div>
            <div>
              <dt>Frames</dt>
              <dd>{recordingPreview.preview.frames}</dd>
            </div>
          </dl>

          <pre className="recording-preview">
            {recordingPreview.preview.outputSample || "Recording contains no stdout frames."}
          </pre>
        </article>
      ) : null}
    </section>
  );
}
