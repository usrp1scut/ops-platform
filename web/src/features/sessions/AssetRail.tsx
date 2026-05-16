import { RefreshCw, Search } from "lucide-react";
import { type ReactNode, useMemo } from "react";

import type { Asset } from "../../api/cmdb";
import { PanelState } from "../../components/PanelState";
import {
  buildAssetTree,
  filterConnectableAssets,
  isConnectableAsset,
  type AssetTreeEnv,
} from "../../lib/launch";

type AssetRailProps = {
  assets: Asset[];
  search: string;
  onSearchChange: (value: string) => void;
  canRead: boolean;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onSelect: (asset: Asset) => void;
  selectedAssetID?: string;
  rowsDisabled?: boolean;
  rowTitle?: (asset: Asset) => string;
  // Sessions injects the SSH/RDP toggle here so the protocol choice travels
  // with the rail; Connect leaves it empty (protocol is chosen in the
  // connection panel instead).
  protocolToggle?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  permissionMessage?: string;
  ariaLabel?: string;
};

// Shared connectable-asset rail: search header + env → vpc → host tree.
// Extracted from SessionsPage so the Connect page can reuse the exact same
// grouping, filtering, and row markup without duplicating it.
export function AssetRail({
  assets,
  search,
  onSearchChange,
  canRead,
  isLoading,
  isError,
  error,
  onSelect,
  selectedAssetID,
  rowsDisabled,
  rowTitle,
  protocolToggle,
  onRefresh,
  refreshing,
  searchPlaceholder = "Search name / ip / vpc",
  emptyMessage = "No connectable assets match this filter.",
  permissionMessage = "Permission required: cmdb.asset:read",
  ariaLabel = "Connectable assets",
}: AssetRailProps) {
  const connectableAssets = useMemo(() => assets.filter(isConnectableAsset), [assets]);
  const filteredConnectables = useMemo(
    () => filterConnectableAssets(connectableAssets, search),
    [connectableAssets, search],
  );
  const assetTree: AssetTreeEnv[] = useMemo(
    () => buildAssetTree(filteredConnectables),
    [filteredConnectables],
  );

  return (
    <aside className="sessions-rail" aria-label={ariaLabel}>
      <div className="sessions-rail-header">
        {protocolToggle}
        <div className="sessions-rail-searchrow">
          <div className="input-with-icon sessions-rail-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              disabled={!canRead}
            />
          </div>
          {onRefresh ? (
            <button
              type="button"
              className="icon-button compact-icon"
              onClick={onRefresh}
              disabled={!canRead || refreshing}
              title={refreshing ? "Refreshing" : "Refresh"}
              aria-label="Refresh assets"
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="sessions-rail-tree">
        {!canRead ? <PanelState kind="permission" message={permissionMessage} /> : null}
        {canRead && isError ? (
          <PanelState
            kind="error"
            message={error instanceof Error ? error.message : "Failed to load assets."}
          />
        ) : null}
        {canRead && isLoading ? <PanelState kind="loading" message="Loading connectable assets" /> : null}
        {canRead && !isLoading && !isError && assetTree.length === 0 ? (
          <PanelState kind="empty" message={emptyMessage} />
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
                        // Secondary line builds 'ip · env · type' so a long
                        // list of biz-01 assets becomes scannable by address +
                        // env at a glance, not just by row order.
                        const secondaryParts: string[] = [];
                        if (addr) secondaryParts.push(addr);
                        if (asset.env) secondaryParts.push(asset.env);
                        const typeLabel = (asset.type || "").replace(/^aws_/, "");
                        if (typeLabel) secondaryParts.push(typeLabel);
                        const selected = Boolean(selectedAssetID) && selectedAssetID === asset.id;
                        return (
                          <button
                            type="button"
                            key={asset.id}
                            className={`asset-tree-row${asset.is_vpc_proxy ? " bastion" : ""}${
                              selected ? " selected" : ""
                            }`}
                            onClick={() => onSelect(asset)}
                            disabled={rowsDisabled}
                            aria-pressed={selectedAssetID ? selected : undefined}
                            title={rowTitle ? rowTitle(asset) : asset.name || asset.id}
                          >
                            <div className="asset-tree-row-primary">
                              {asset.is_vpc_proxy ? (
                                <span className="asset-tree-bastion" aria-label="bastion" />
                              ) : null}
                              <span className="asset-tree-name">{asset.name || asset.id}</span>
                            </div>
                            {secondaryParts.length > 0 ? (
                              <div className="asset-tree-row-secondary">{secondaryParts.join(" · ")}</div>
                            ) : null}
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
      </div>
    </aside>
  );
}
