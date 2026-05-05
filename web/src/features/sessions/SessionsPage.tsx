import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Download,
  MonitorPlay,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  SquareTerminal,
  Timer,
  Video,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import {
  getAsset,
  getAssetConnectionProfile,
  listAssets,
  type Asset,
  type AssetConnectionProfile,
} from "../../api/cmdb";
import {
  getSessionRecording,
  issueRdpTicket,
  issueTerminalTicket,
  listSessions,
  type SessionAuditRecord,
} from "../../api/sessions";
import { PanelState } from "../../components/PanelState";
import { PermissionList } from "../../components/PermissionList";
import {
  buildAssetTree,
  filterConnectableAssets,
  isConnectableAsset,
  parseLaunchParams,
  type AssetTreeEnv,
} from "../../lib/launch";
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
import { RdpSessionPane, type LiveRDPStatus } from "./RdpSessionPane";
import { SshTerminalPane, type LiveSSHStatus } from "./SshTerminalPane";

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

type LaunchProtocol = "ssh" | "rdp";
type LiveSessionStatus = LiveSSHStatus | LiveRDPStatus;

type LiveSession = {
  asset: Asset;
  expiresAt: string;
  id: string;
  kind: LaunchProtocol;
  message?: string;
  status: LiveSessionStatus;
  ticket: string;
};

type TerminalLaunchResult = {
  asset: Asset;
  expiresAt: string;
  kind: LaunchProtocol;
  ticket: string;
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

function assetOptionLabel(asset: Asset) {
  const name = asset.name || asset.id;
  const detail = [asset.env, asset.region, asset.private_ip || asset.public_ip].filter(Boolean).join(" / ");

  return detail ? `${name} (${detail})` : name;
}

function hasSSHCredentials(asset: Asset, profile: AssetConnectionProfile) {
  return profile.has_password || profile.has_private_key || Boolean(asset.key_name);
}

function hasRDPCredentials(profile: AssetConnectionProfile) {
  return profile.has_password;
}

function isNotFoundError(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

function createLiveSessionID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function SessionsPage() {
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
  const [assetQuery, setAssetQuery] = useState("");
  const [selectedAssetID, setSelectedAssetID] = useState("");
  const [launchProtocol, setLaunchProtocol] = useState<LaunchProtocol>("ssh");
  const [launchFeedback, setLaunchFeedback] = useState<ActionFeedback | null>(null);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [activeLiveID, setActiveLiveID] = useState("");
  const [recordingFeedback, setRecordingFeedback] = useState<ActionFeedback | null>(null);
  const [recordingPreview, setRecordingPreview] = useState<RecordingPreviewState | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const effectiveUserID = canReadAllSessions ? filters.userID.trim() : "";
  const effectiveAssetID = filters.assetID.trim();
  const assetSearch = useQuery({
    queryKey: ["cmdb", "assets", "sessions-terminal-search", userID, assetQuery],
    queryFn: () => listAssets({ limit: 30, query: assetQuery.trim() || undefined, status: "active" }),
    enabled: canReadSessions && Boolean(userID),
  });
  const sidebarAssets = useQuery({
    // Mirrors the legacy /portal sidebar: pull a wide window of assets
    // and group them client-side. limit:500 matches the classic-script
    // portal so behaviour stays consistent for fleets up to that size.
    queryKey: ["cmdb", "assets", "sessions-sidebar", userID],
    queryFn: () => listAssets({ limit: 500 }),
    enabled: canReadSessions && Boolean(userID),
  });
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
    // Default in TanStack Query v5 — set explicitly so the intent survives a
    // future bump or a global QueryClient reconfiguration. Keeps the API
    // quiet when the operator parks the tab in the background.
    refetchIntervalInBackground: false,
  });
  const assetItems = assetSearch.data?.items || [];
  const sessionItems = sessions.data?.items || [];
  const counts = sessionCounts(sessionItems);
  const visibleSessions = useMemo(
    () => filterSessionsByStatus(sessionItems, filters.status),
    [filters.status, sessionItems],
  );
  const sidebarItems = sidebarAssets.data?.items || [];
  const connectableAssets = useMemo(() => sidebarItems.filter(isConnectableAsset), [sidebarItems]);
  const filteredConnectables = useMemo(
    () => filterConnectableAssets(connectableAssets, sidebarSearch),
    [connectableAssets, sidebarSearch],
  );
  const assetTree: AssetTreeEnv[] = useMemo(
    () => buildAssetTree(filteredConnectables),
    [filteredConnectables],
  );
  const updateLiveSessionStatus = useCallback((sessionID: string, status: LiveSessionStatus, message?: string) => {
    setLiveSessions((current) =>
      current.map((session) => (session.id === sessionID ? { ...session, message, status } : session)),
    );
  }, []);
  const closeLiveSession = useCallback((sessionID: string) => {
    setLiveSessions((current) => {
      const next = current.filter((session) => session.id !== sessionID);
      setActiveLiveID((activeID) => (activeID === sessionID ? next[0]?.id || "" : activeID));
      return next;
    });
  }, []);
  const launchTerminal = useMutation({
    mutationFn: async ({
      assetID,
      protocol,
    }: {
      assetID: string;
      protocol: LaunchProtocol;
    }): Promise<TerminalLaunchResult> => {
      const asset = await getAsset(assetID);
      let profile: AssetConnectionProfile;

      try {
        profile = await getAssetConnectionProfile(assetID);
      } catch (error) {
        if (isNotFoundError(error)) {
          throw new Error("This asset has no connection profile. Save SSH credentials in CMDB first.");
        }
        throw error;
      }

      if ((profile.protocol || "ssh") !== protocol) {
        throw new Error(
          `${protocol.toUpperCase()} launch is only available for ${protocol} connection profiles. This asset uses ${
            profile.protocol || "ssh"
          }.`,
        );
      }
      if (protocol === "ssh" && !hasSSHCredentials(asset, profile)) {
        throw new Error("SSH connection has no saved credentials or EC2 KeyName.");
      }
      if (protocol === "rdp" && !hasRDPCredentials(profile)) {
        throw new Error("RDP connection has no saved password.");
      }

      const ticket = protocol === "ssh" ? await issueTerminalTicket(assetID) : await issueRdpTicket(assetID);
      if (!ticket.ticket) throw new Error(`No ${protocol.toUpperCase()} ticket returned.`);

      return {
        asset,
        expiresAt: ticket.expires_at,
        kind: protocol,
        ticket: ticket.ticket,
      };
    },
    onMutate: () => {
      setLaunchFeedback(null);
    },
    onSuccess: (result) => {
      const sessionID = createLiveSessionID();
      setLiveSessions((current) => [
        ...current,
        {
          asset: result.asset,
          expiresAt: result.expiresAt,
          id: sessionID,
          kind: result.kind,
          status: "connecting",
          ticket: result.ticket,
        },
      ]);
      setActiveLiveID(sessionID);
      setLaunchFeedback({
        kind: "success",
        message: `${result.kind.toUpperCase()} ticket issued for ${result.asset.name || result.asset.id}.`,
      });
    },
    onError: (error) => {
      setLaunchFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to launch terminal.",
      });
    },
  });
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

  function launchSelectedAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const assetID = selectedAssetID.trim();
    if (!assetID) {
      setLaunchFeedback({ kind: "error", message: `Select an asset before launching ${launchProtocol.toUpperCase()}.` });
      return;
    }

    launchTerminal.mutate({ assetID, protocol: launchProtocol });
  }

  function quickLaunch(asset: Asset) {
    launchTerminal.mutate({ assetID: asset.id, protocol: launchProtocol });
  }

  // Auto-launch when the operator arrives via /sessions?launch=...&protocol=...
  // (e.g. from the CMDB list's Connect button). The ref keeps each
  // (asset, protocol) tuple from re-firing on subsequent renders, and the
  // params are cleared after the mutation is started so a refresh does not
  // re-trigger the launch.
  const consumedLaunchKeyRef = useRef("");
  useEffect(() => {
    if (!canReadSessions || !userID) return;
    const spec = parseLaunchParams(searchParams);
    if (!spec) return;
    const key = `${spec.assetID}|${spec.protocol}`;
    if (consumedLaunchKeyRef.current === key) return;
    consumedLaunchKeyRef.current = key;
    setLaunchProtocol(spec.protocol);
    launchTerminal.mutate({ assetID: spec.assetID, protocol: spec.protocol });
    setSearchParams({}, { replace: true });
  }, [canReadSessions, userID, searchParams, launchTerminal, setSearchParams]);

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Live access</p>
          <h1>Sessions</h1>
        </div>
        <span className={`status-pill ${canReadSessions ? "ok" : "warn"}`}>
          <ShieldCheck size={14} aria-hidden="true" />
          {canReadSessions ? "cmdb.asset:read" : "Needs cmdb.asset:read"}
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

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Quick launch</p>
            <h2>Connectable assets</h2>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => void sidebarAssets.refetch()}
            disabled={!canReadSessions || sidebarAssets.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{sidebarAssets.isFetching ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>

        {!canReadSessions ? <PanelState kind="permission" message="Permission required: cmdb.asset:read" /> : null}
        {canReadSessions && sidebarAssets.isError ? (
          <PanelState
            kind="error"
            message={sidebarAssets.error instanceof Error ? sidebarAssets.error.message : "Failed to load assets."}
          />
        ) : null}

        <label className="form-field search-field">
          <span>Search</span>
          <div className="input-with-icon">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={sidebarSearch}
              onChange={(event) => setSidebarSearch(event.target.value)}
              placeholder="Name, IP, env, VPC, type"
              disabled={!canReadSessions}
            />
          </div>
        </label>

        {canReadSessions && sidebarAssets.isLoading ? (
          <PanelState kind="loading" message="Loading connectable assets" />
        ) : null}

        {canReadSessions && !sidebarAssets.isLoading && !sidebarAssets.isError && assetTree.length === 0 ? (
          <PanelState kind="empty" message="No connectable assets match this filter." />
        ) : null}

        {assetTree.length > 0 ? (
          <div className="asset-tree">
            {assetTree.map((env) => (
              <details className="asset-tree-env" key={env.envName} open>
                <summary>
                  <span>env · {env.envName}</span>
                  <span className="muted">({env.total})</span>
                </summary>
                {env.vpcs.map((vpc) => (
                  <details
                    className="asset-tree-vpc"
                    key={`${env.envName}::${vpc.vpcKey}`}
                    open
                  >
                    <summary>
                      <span>
                        vpc · <code>{vpc.vpcLabel}</code>
                      </span>
                      <span className="muted">({vpc.count})</span>
                    </summary>
                    <div className="asset-tree-members">
                      {[...vpc.bastions, ...vpc.members].map((asset) => {
                        const addr = asset.public_ip || asset.private_ip || asset.private_dns;
                        return (
                          <button
                            type="button"
                            key={asset.id}
                            className={`asset-tree-row${asset.is_vpc_proxy ? " bastion" : ""}`}
                            onClick={() => quickLaunch(asset)}
                            disabled={launchTerminal.isPending}
                            title={`Launch ${launchProtocol.toUpperCase()} to ${asset.name || asset.id}`}
                          >
                            {asset.is_vpc_proxy ? (
                              <span className="status-pill ok tiny">bastion</span>
                            ) : null}
                            <span className="asset-tree-name">{asset.name || asset.id}</span>
                            {addr ? <span className="asset-tree-addr">{addr}</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </details>
            ))}
          </div>
        ) : null}

        <p className="muted">
          Click a row to launch <strong>{launchProtocol.toUpperCase()}</strong>. Switch the protocol in the
          panel below before clicking to start an RDP session instead.
        </p>
      </article>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Live access</p>
            <h2>Launch session</h2>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => void assetSearch.refetch()}
            disabled={!canReadSessions || assetSearch.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{assetSearch.isFetching ? "Refreshing" : "Refresh assets"}</span>
          </button>
        </div>

        {launchFeedback ? <PanelState kind={launchFeedback.kind} message={launchFeedback.message} /> : null}
        {!canReadSessions ? <PanelState kind="permission" message="Permission required: cmdb.asset:read" /> : null}
        {canReadSessions && assetSearch.isError ? (
          <PanelState
            kind="error"
            message={assetSearch.error instanceof Error ? assetSearch.error.message : "Failed to load assets."}
          />
        ) : null}

        <form className="request-form" onSubmit={launchSelectedAsset}>
          <div className="drawer-tabs" role="tablist" aria-label="Launch protocol">
            {[
              { label: "SSH", value: "ssh" },
              { label: "RDP", value: "rdp" },
            ].map((item) => (
              <button
                type="button"
                className={`drawer-tab${launchProtocol === item.value ? " active" : ""}`}
                key={item.value}
                onClick={() => setLaunchProtocol(item.value as LaunchProtocol)}
                role="tab"
                aria-selected={launchProtocol === item.value}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="form-grid">
            <label className="form-field">
              <span>Asset search</span>
              <input
                type="search"
                value={assetQuery}
                onChange={(event) => setAssetQuery(event.target.value)}
                placeholder="Name, IP, owner, region"
                disabled={!canReadSessions}
              />
            </label>

            <label className="form-field">
              <span>Asset</span>
              <select
                value={selectedAssetID}
                onChange={(event) => setSelectedAssetID(event.target.value)}
                disabled={!canReadSessions || assetSearch.isLoading}
              >
                <option value="">Select an active asset</option>
                {assetItems.map((asset) => (
                  <option value={asset.id} key={asset.id}>
                    {assetOptionLabel(asset)}
                  </option>
                ))}
              </select>
            </label>

            <div className="form-actions align-end">
              <button
                type="submit"
                className="primary-button"
                disabled={!canReadSessions || launchTerminal.isPending || !selectedAssetID}
              >
                <Play size={16} aria-hidden="true" />
                <span>
                  {launchTerminal.isPending ? "Launching" : `Launch ${launchProtocol.toUpperCase()}`}
                </span>
              </button>
            </div>
          </div>

          {canReadSessions && assetSearch.isLoading ? <PanelState kind="loading" message="Loading active assets" /> : null}
          {canReadSessions && !assetSearch.isLoading && !assetSearch.isError && assetItems.length === 0 ? (
            <PanelState kind="empty" message="No active assets match this search." />
          ) : null}
        </form>

        {liveSessions.length > 0 ? (
          <div className="live-session-shell">
            <div className="live-session-tabs" role="tablist" aria-label="Live sessions">
              {liveSessions.map((session) => (
                <div className={`live-session-tab${activeLiveID === session.id ? " active" : ""}`} key={session.id}>
                  <button
                    type="button"
                    className="live-session-tab-main"
                    onClick={() => setActiveLiveID(session.id)}
                    role="tab"
                    aria-selected={activeLiveID === session.id}
                  >
                    <span className="kind-tag">{session.kind.toUpperCase()}</span>
                    <span className="session-label">{session.asset.name || session.asset.id}</span>
                    <span className={`status-pill ${session.status === "error" ? "warn" : "info"}`}>
                      {session.status}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button compact-icon"
                    onClick={() => closeLiveSession(session.id)}
                    title="Close terminal"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>

            <div className="live-session-stage">
              {liveSessions.map((session) => (
                <div className="live-session-panel" hidden={activeLiveID !== session.id} key={session.id}>
                  {session.kind === "ssh" ? (
                    <SshTerminalPane
                      active={activeLiveID === session.id}
                      assetID={session.asset.id}
                      assetName={session.asset.name || session.asset.id}
                      onStatusChange={updateLiveSessionStatus}
                      sessionID={session.id}
                      ticket={session.ticket}
                    />
                  ) : (
                    <RdpSessionPane
                      active={activeLiveID === session.id}
                      assetID={session.asset.id}
                      assetName={session.asset.name || session.asset.id}
                      onStatusChange={updateLiveSessionStatus}
                      sessionID={session.id}
                      ticket={session.ticket}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <PanelState kind="empty" message="No live sessions open." />
        )}
      </article>

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
                      <strong>{session.user_name || session.user_id}</strong>
                      <div className="muted">{session.user_id}</div>
                    </td>
                    <td>
                      <strong>{session.asset_name || session.asset_id}</strong>
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
