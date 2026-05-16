import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock,
  Database,
  KeyRound,
  MonitorPlay,
  Search,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getAsset, listAssets, type Asset } from "../../api/cmdb";
import { listMyActiveBastionGrants } from "../../api/bastion";
import { PanelState } from "../../components/PanelState";
import { formatGrantTimeRemaining } from "../../lib/bastionGrants";
import { buildLaunchSearch, type LaunchProtocol } from "../../lib/launch";
import { useAuth } from "../auth/AuthProvider";
import { AssetRail } from "../sessions/AssetRail";

function statusTone(status: string | undefined) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "active") return "ok";
  if (normalized === "inactive" || normalized === "deleted") return "warn";
  return "info";
}

function assetAddress(asset: Asset) {
  return asset.public_ip || asset.private_ip || asset.private_dns || asset.id;
}

function tagEntries(asset: Asset | undefined) {
  if (!asset) return [] as Array<[string, string]>;
  const merged: Record<string, unknown> = {
    ...(asset.system_tags || {}),
    ...(asset.labels || {}),
    ...(asset.tags || {}),
  };
  return Object.entries(merged)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, value == null ? "" : String(value)] as [string, string]);
}

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ConnectPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const userID = auth.identity?.user.id || "";
  const canReadAssets = auth.can("cmdb.asset:read");
  const canReadGrants = auth.can("bastion.grant:read");
  const canRequestAccess = auth.can("bastion.request:write");

  const [railSearch, setRailSearch] = useState("");
  const [selectedAssetID, setSelectedAssetID] = useState("");

  // Connect is a wide three-column surface; opt into the lighter
  // fullwidth shell (same as CMDB) so the rail + panels can use the
  // screen without the centered page cap.
  useEffect(() => {
    document.body.classList.add("fullwidth-mode");
    return () => {
      document.body.classList.remove("fullwidth-mode");
    };
  }, []);

  // Mirrors the Sessions sidebar: a wide window of assets grouped client
  // side by the shared AssetRail. Same query key/shape as elsewhere so the
  // react-query cache is shared, not duplicated.
  const railAssets = useQuery({
    queryKey: ["cmdb", "assets", "sessions-sidebar", userID],
    queryFn: () => listAssets({ limit: 500 }),
    enabled: canReadAssets && Boolean(userID),
  });
  const assetDetail = useQuery({
    queryKey: ["cmdb", "assets", "detail", userID, selectedAssetID],
    queryFn: () => getAsset(selectedAssetID),
    enabled: canReadAssets && Boolean(userID) && Boolean(selectedAssetID),
  });
  const myActiveGrants = useQuery({
    queryKey: ["bastion", "grants", "active", "mine", userID],
    queryFn: () => listMyActiveBastionGrants(userID, 50),
    enabled: canReadGrants && Boolean(userID),
  });

  const selectedAsset = assetDetail.data;
  const grantItems = myActiveGrants.data?.items || [];
  const activeGrant = useMemo(
    () => grantItems.find((grant) => grant.asset_id === selectedAssetID && grant.active),
    [grantItems, selectedAssetID],
  );

  function openLive(protocol: LaunchProtocol) {
    if (!selectedAssetID) return;
    navigate(`/sessions${buildLaunchSearch({ assetID: selectedAssetID, protocol })}`);
  }

  const tags = tagEntries(selectedAsset);

  return (
    <section className="page-section connect-page">
      <div className="page-header connect-header">
        <div>
          <p className="eyebrow">Operate</p>
          <h1>Connect</h1>
        </div>
        <button
          type="button"
          className="connect-cmdk"
          onClick={() => navigate("/cmdb")}
          title="Search the full inventory in CMDB"
        >
          <Search size={15} aria-hidden="true" />
          <span>Search assets…</span>
          <kbd>⌘K</kbd>
        </button>
        <span className={`status-pill ${canReadAssets ? "ok" : "warn"}`} title="Required permission">
          <ShieldCheck size={14} aria-hidden="true" />
          {canReadAssets ? "cmdb.asset:read" : "no access"}
        </span>
      </div>

      <div className="connect-workspace">
        <AssetRail
          assets={railAssets.data?.items || []}
          search={railSearch}
          onSearchChange={setRailSearch}
          canRead={canReadAssets}
          isLoading={railAssets.isLoading}
          isError={railAssets.isError}
          error={railAssets.error}
          onSelect={(asset) => setSelectedAssetID(asset.id)}
          selectedAssetID={selectedAssetID}
          onRefresh={() => void railAssets.refetch()}
          refreshing={railAssets.isFetching}
          rowTitle={(asset) => `Select ${asset.name || asset.id}`}
          ariaLabel="Connectable assets"
        />

        <div className="connect-main">
          {!selectedAssetID ? (
            <div className="connect-empty">
              <h3>Pick an asset to connect</h3>
              <p className="muted">
                Choose an environment, VPC, and host from the left rail. Connection options and
                your access window show up here.
              </p>
            </div>
          ) : assetDetail.isLoading ? (
            <PanelState kind="loading" message="Loading asset" />
          ) : assetDetail.isError ? (
            <PanelState
              kind="error"
              message={
                assetDetail.error instanceof Error ? assetDetail.error.message : "Failed to load asset."
              }
            />
          ) : selectedAsset ? (
            <>
              <header className="connect-detail-head">
                <div>
                  <p className="eyebrow">{selectedAsset.type || "asset"}</p>
                  <div className="connect-detail-title">
                    <h2>{selectedAsset.name || selectedAsset.id}</h2>
                    <span className={`status-pill ${statusTone(selectedAsset.status)}`}>
                      {selectedAsset.status || "unknown"}
                    </span>
                  </div>
                  <p className="muted">
                    <code>{assetAddress(selectedAsset)}</code>
                    {selectedAsset.env ? <span> · {selectedAsset.env}</span> : null}
                    {selectedAsset.region ? <span> · {selectedAsset.region}</span> : null}
                  </p>
                </div>
                <div className="request-actions">
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => openLive("ssh")}
                  >
                    <SquareTerminal size={14} aria-hidden="true" />
                    <span>Open SSH</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => openLive("rdp")}
                  >
                    <MonitorPlay size={14} aria-hidden="true" />
                    <span>Open RDP</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={() => navigate("/cmdb")}
                  >
                    <Database size={14} aria-hidden="true" />
                    <span>View in CMDB</span>
                  </button>
                </div>
              </header>

              <article className="work-panel connect-conn-panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Connection</p>
                    <h2>{activeGrant ? "You can open this now" : "Request access"}</h2>
                  </div>
                  {activeGrant ? (
                    <span className="status-pill ok">
                      <Clock size={14} aria-hidden="true" />
                      {formatGrantTimeRemaining(activeGrant.expires_at)}
                    </span>
                  ) : (
                    <span className="status-pill warn">no active grant</span>
                  )}
                </div>

                {activeGrant ? (
                  <>
                    <p className="muted">
                      Active access window expires {formatDateTime(activeGrant.expires_at)}.
                    </p>
                    <div className="form-actions">
                      <button type="button" className="primary-button compact" onClick={() => openLive("ssh")}>
                        <SquareTerminal size={16} aria-hidden="true" />
                        <span>Open SSH</span>
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => openLive("rdp")}
                      >
                        <MonitorPlay size={14} aria-hidden="true" />
                        <span>Open RDP</span>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      {canReadGrants
                        ? "You don't have an active access grant for this asset yet."
                        : "Grant visibility is limited — request access to open a session."}
                    </p>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="primary-button compact"
                        onClick={() => navigate("/access")}
                        disabled={!canRequestAccess}
                        title={
                          canRequestAccess
                            ? "Go to Access to request a grant"
                            : "Permission required: bastion.request:write"
                        }
                      >
                        <KeyRound size={16} aria-hidden="true" />
                        <span>Request access</span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </>
                )}
              </article>
            </>
          ) : null}
        </div>

        <aside className="connect-side" aria-label="Asset context">
          <article className="work-panel connect-card">
            <p className="eyebrow">Recent usage</p>
            {selectedAsset ? (
              <>
                <dl className="connect-card-list">
                  <div>
                    <dt>Last updated</dt>
                    <dd>{formatDateTime(selectedAsset.updated_at)}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatDateTime(selectedAsset.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{selectedAsset.source || "manual"}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="secondary-button compact text-link-button"
                  onClick={() => navigate("/audit")}
                >
                  Open Audit →
                </button>
              </>
            ) : (
              <p className="muted">Select an asset to see its activity.</p>
            )}
          </article>

          <article className="work-panel connect-card">
            <p className="eyebrow">Who has access</p>
            {!selectedAsset ? (
              <p className="muted">Select an asset to check access.</p>
            ) : !canReadGrants ? (
              <p className="muted">Permission required: bastion.grant:read</p>
            ) : activeGrant ? (
              <>
                <p>
                  <strong>You</strong> — active until {formatDateTime(activeGrant.expires_at)}
                </p>
                <p className="muted">{formatGrantTimeRemaining(activeGrant.expires_at)}</p>
              </>
            ) : (
              <p className="muted">No active grant for you on this asset.</p>
            )}
            <button
              type="button"
              className="secondary-button compact text-link-button"
              onClick={() => navigate("/access")}
            >
              Manage access →
            </button>
          </article>

          <article className="work-panel connect-card">
            <p className="eyebrow">Tags</p>
            {!selectedAsset ? (
              <p className="muted">Select an asset to see its tags.</p>
            ) : tags.length === 0 ? (
              <p className="muted">No tags.</p>
            ) : (
              <div className="chip-list">
                {tags.map(([key, value]) => (
                  <span className="chip" key={key}>
                    {value ? `${key}: ${value}` : key}
                  </span>
                ))}
              </div>
            )}
          </article>
        </aside>
      </div>
    </section>
  );
}
