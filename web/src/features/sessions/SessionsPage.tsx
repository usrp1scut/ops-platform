import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Play,
  ShieldCheck,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiError } from "../../api/client";
import {
  getAsset,
  getAssetConnectionProfile,
  listAssets,
  type Asset,
  type AssetConnectionProfile,
} from "../../api/cmdb";
import { issueRdpTicket, issueTerminalTicket } from "../../api/sessions";
import { PanelState } from "../../components/PanelState";
import { parseLaunchParams } from "../../lib/launch";
import { useAuth } from "../auth/AuthProvider";
import { AssetRail } from "./AssetRail";
import { RdpSessionPane, type LiveRDPStatus } from "./RdpSessionPane";
import { SshTerminalPane, type LiveSSHStatus } from "./SshTerminalPane";

type ActionFeedback = {
  kind: "error" | "success";
  message: string;
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
  const canReadSessions = auth.can("cmdb.asset:read");
  const canReadAllSessions = auth.can("bastion.session:read");
  const [assetQuery, setAssetQuery] = useState("");
  const [selectedAssetID, setSelectedAssetID] = useState("");
  const [launchProtocol, setLaunchProtocol] = useState<LaunchProtocol>("ssh");
  const [launchFeedback, setLaunchFeedback] = useState<ActionFeedback | null>(null);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [activeLiveID, setActiveLiveID] = useState("");
  const [sidebarSearch, setSidebarSearch] = useState("");
  // "Launch by ID" used to live as a bottom panel under the terminal,
  // squeezing the terminal whenever it appeared. It now lives in a
  // dialog opened from the header — invoked only when the operator
  // can't (or doesn't want to) find the asset in the rail.
  const [launchByIdOpen, setLaunchByIdOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Sessions is now purely the live workspace: drop the
  // page-frame padding + .page-section width cap so the terminal can fill
  // the viewport. Driven by a body class so we can override the shell-level
  // padding rules from a leaf component without prop-drilling.
  useEffect(() => {
    document.body.classList.add("workspace-mode");
    return () => {
      document.body.classList.remove("workspace-mode");
    };
  }, []);

  // launchFeedback is a transient confirmation ("ticket issued",
  // "permission denied", etc). In a workspace it should not push the
  // terminal down — auto-dismiss after a few seconds and render it as a
  // floating toast instead of a structural panel. Errors stay slightly
  // longer so the operator has time to read.
  useEffect(() => {
    if (!launchFeedback) return;
    const ttl = launchFeedback.kind === "error" ? 8000 : 4000;
    const t = window.setTimeout(() => setLaunchFeedback(null), ttl);
    return () => window.clearTimeout(t);
  }, [launchFeedback]);
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
  const assetItems = assetSearch.data?.items || [];
  const sidebarItems = sidebarAssets.data?.items || [];
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

  // SSH/RDP toggle injected into the shared AssetRail header so the
  // protocol choice sits with search + refresh and travels with the rail.
  const railProtocolToggle = (
    <div className="sessions-rail-protocol drawer-tabs" role="tablist" aria-label="Launch protocol">
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
          title={`Click a row to launch ${item.label} to the asset`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  return (
    <section className="page-section sessions-page live-mode">
      <div className="page-header sessions-header">
        <h1>Sessions</h1>
        <div className="sessions-header-actions">
          <span className={`status-pill ${canReadSessions ? "ok" : "warn"}`} title="Required permission">
            <ShieldCheck size={14} aria-hidden="true" />
            {canReadAllSessions ? "all sessions" : canReadSessions ? "own sessions" : "no access"}
          </span>
          <Link className="secondary-button compact" to="/audit">
            Open Audit →
          </Link>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => setLaunchByIdOpen(true)}
            disabled={!canReadSessions}
            title="Launch a session by typing the asset ID"
          >
            <Play size={14} aria-hidden="true" />
            <span>Launch by ID</span>
          </button>
        </div>
      </div>

      <div className="sessions-workspace">
          <AssetRail
            assets={sidebarItems}
            search={sidebarSearch}
            onSearchChange={setSidebarSearch}
            canRead={canReadSessions}
            isLoading={sidebarAssets.isLoading}
            isError={sidebarAssets.isError}
            error={sidebarAssets.error}
            onSelect={quickLaunch}
            rowsDisabled={launchTerminal.isPending}
            rowTitle={(asset) =>
              `Launch ${launchProtocol.toUpperCase()} to ${asset.name || asset.id}`
            }
            protocolToggle={railProtocolToggle}
            onRefresh={() => void sidebarAssets.refetch()}
            refreshing={sidebarAssets.isFetching}
          />
          <div className="sessions-pane">
            {launchFeedback ? (
              <div className={`sessions-toast ${launchFeedback.kind}`} role="status">
                <span>{launchFeedback.message}</span>
                <button
                  type="button"
                  className="sessions-toast-close"
                  onClick={() => setLaunchFeedback(null)}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            ) : null}
            {liveSessions.length > 0 ? (
              <div className="live-session-shell">
                <div className="live-session-tabs" role="tablist" aria-label="Live sessions">
                  {liveSessions.map((session) => {
                    const tabTitle = session.message
                      ? `${session.asset.name || session.asset.id} — ${session.status}: ${session.message}`
                      : `${session.asset.name || session.asset.id} — ${session.status}`;
                    const errorBlurb = session.status === "error" && session.message
                      ? session.message.length > 40
                        ? session.message.slice(0, 40) + "…"
                        : session.message
                      : "";
                    return (
                    <div className={`live-session-tab${activeLiveID === session.id ? " active" : ""}${session.status === "error" ? " error" : ""}`} key={session.id}>
                      <button
                        type="button"
                        className="live-session-tab-main"
                        onClick={() => setActiveLiveID(session.id)}
                        role="tab"
                        aria-selected={activeLiveID === session.id}
                        title={tabTitle}
                      >
                        <span className="kind-tag">{session.kind.toUpperCase()}</span>
                        <span className="session-label">{session.asset.name || session.asset.id}</span>
                        <span className={`status-pill ${session.status === "error" ? "warn" : "info"}`}>
                          {session.status}
                        </span>
                        {errorBlurb ? (
                          <span className="live-session-tab-err">{errorBlurb}</span>
                        ) : null}
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
                    );
                  })}
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
              <div className="sessions-pane-empty">
                <h3>No active sessions</h3>
                <p className="muted">
                  Pick an asset from the left rail to open a new session, or use the form below to launch by ID.
                </p>
              </div>
            )}
          </div>
      </div>

      {launchByIdOpen ? (
        <div className="sessions-launch-modal" role="dialog" aria-modal="true" aria-label="Launch session by asset ID">
          <button
            type="button"
            className="sessions-launch-backdrop"
            aria-label="Close"
            onClick={() => setLaunchByIdOpen(false)}
          />
          <div className="sessions-launch-card">
            <div className="sessions-launch-head">
              <div>
                <p className="eyebrow">Live access</p>
                <h2>Launch by ID</h2>
              </div>
              <button
                type="button"
                className="icon-button compact-icon"
                onClick={() => setLaunchByIdOpen(false)}
                title="Close"
                aria-label="Close"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>

            {canReadSessions && assetSearch.isError ? (
              <PanelState
                kind="error"
                message={assetSearch.error instanceof Error ? assetSearch.error.message : "Failed to load assets."}
              />
            ) : null}

            <form
              className="request-form"
              onSubmit={(event) => {
                launchSelectedAsset(event);
                setLaunchByIdOpen(false);
              }}
            >
              <div className="form-grid">
                <label className="form-field">
                  <span>Asset search</span>
                  <input
                    type="search"
                    value={assetQuery}
                    onChange={(event) => setAssetQuery(event.target.value)}
                    placeholder="Name, IP, owner, region"
                    disabled={!canReadSessions}
                    autoFocus
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
              </div>

              {canReadSessions && assetSearch.isLoading ? (
                <PanelState kind="loading" message="Loading active assets" />
              ) : null}
              {canReadSessions && !assetSearch.isLoading && !assetSearch.isError && assetItems.length === 0 ? (
                <PanelState kind="empty" message="No active assets match this search." />
              ) : null}

              <div className="sessions-launch-foot">
                <button
                  type="button"
                  className="secondary-button compact"
                  onClick={() => setLaunchByIdOpen(false)}
                >
                  Cancel
                </button>
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
            </form>
          </div>
        </div>
      ) : null}

    </section>
  );
}



