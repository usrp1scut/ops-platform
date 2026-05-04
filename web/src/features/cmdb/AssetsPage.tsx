import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Eye, FilterX, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "../../api/client";
import {
  getAsset,
  getAssetConnectionProfile,
  getLatestAssetProbe,
  listAssetRelations,
  listAssetFacets,
  listAssets,
  testAssetConnection,
  updateAssetConnectionProfile,
  type Asset,
  type AssetConnectionProfile,
  type AssetConnectionTestResult,
  type AssetProbeSnapshot,
  type AssetRelation,
  type ListAssetsOptions,
  type UpdateAssetConnectionProfilePayload,
} from "../../api/cmdb";
import { PanelState } from "../../components/PanelState";
import { formatAssetRange, nextAssetOffset, previousAssetOffset } from "../../lib/assets";
import { useAuth } from "../auth/AuthProvider";

const pageSize = 25;
const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type AssetFilters = {
  env: string;
  includeBastions: boolean;
  query: string;
  region: string;
  source: string;
  status: string;
  type: string;
};

type ConnectionFormState = {
  authType: string;
  bastionEnabled: boolean;
  database: string;
  host: string;
  passphrase: string;
  password: string;
  port: string;
  privateKey: string;
  protocol: string;
  proxyID: string;
  username: string;
};

type DrawerTab = "summary" | "connection" | "probe" | "relations" | "metadata";

const initialFilters: AssetFilters = {
  env: "",
  includeBastions: false,
  query: "",
  region: "",
  source: "",
  status: "",
  type: "",
};

const drawerTabs: Array<{ id: DrawerTab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "connection", label: "Connection" },
  { id: "probe", label: "Probe" },
  { id: "relations", label: "Relations" },
  { id: "metadata", label: "Metadata" },
];

function defaultConnectionPort(protocol: string) {
  if (protocol === "postgres") return 5432;
  if (protocol === "rdp") return 3389;
  return 22;
}

function compact(value: string) {
  return value.trim() || undefined;
}

function connectionFormFromProfile(profile: AssetConnectionProfile | undefined, asset: Asset): ConnectionFormState {
  const protocol = profile?.protocol || "ssh";

  return {
    authType: profile?.auth_type || "password",
    bastionEnabled: profile ? profile.bastion_enabled : true,
    database: profile?.database || "",
    host: profile?.host || asset.private_ip || asset.public_ip || asset.private_dns || "",
    passphrase: "",
    password: "",
    port: String(profile?.port || defaultConnectionPort(protocol)),
    privateKey: "",
    protocol,
    proxyID: profile?.proxy_id || "",
    username: profile?.username || "",
  };
}

function connectionFormToPayload(form: ConnectionFormState): UpdateAssetConnectionProfilePayload {
  const protocol = form.protocol || "ssh";
  const authType = protocol === "postgres" || protocol === "rdp" ? "password" : form.authType || "password";
  const payload: UpdateAssetConnectionProfilePayload = {
    auth_type: authType,
    bastion_enabled: form.bastionEnabled,
    database: protocol === "postgres" ? form.database.trim() : "",
    host: form.host.trim(),
    port: Number(form.port) || defaultConnectionPort(protocol),
    protocol,
    proxy_id: form.proxyID.trim(),
    username: form.username.trim(),
  };

  if (authType === "password" && form.password !== "") {
    payload.password = form.password;
  }
  if (authType === "key") {
    if (form.privateKey !== "") payload.private_key = form.privateKey;
    if (form.passphrase !== "") payload.passphrase = form.passphrase;
  }

  return payload;
}

function buildAssetListOptions(filters: AssetFilters, offset: number): ListAssetsOptions {
  return {
    env: compact(filters.env),
    isVPCProxy: filters.includeBastions ? undefined : false,
    limit: pageSize,
    offset,
    query: compact(filters.query),
    region: compact(filters.region),
    source: compact(filters.source),
    status: compact(filters.status),
    type: compact(filters.type),
  };
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === "active") return "ok";
  if (normalized === "inactive" || normalized === "deleted") return "warn";
  return "info";
}

function sourceTone(source: string) {
  return source.toLowerCase() === "aws" ? "info" : "";
}

function networkText(asset: Asset) {
  return [asset.public_ip, asset.private_ip].filter(Boolean).join(" / ") || "-";
}

function facetOptions(values: string[] | undefined, selected: string) {
  const set = new Set(values || []);
  if (selected) set.add(selected);
  return Array.from(set).filter(Boolean).sort();
}

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function metadataEntries(values: Record<string, unknown> | undefined) {
  return Object.entries(values || {}).sort(([left], [right]) => left.localeCompare(right));
}

function formatMetadataValue(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
}

function formatMemoryMB(value: number | undefined) {
  if (!value) return "-";
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${value} MB`;
}

function formatUptimeSeconds(value: number | undefined) {
  if (!value) return "-";

  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const parts = [
    days ? `${days}d` : "",
    hours ? `${hours}h` : "",
    minutes || (!days && !hours) ? `${minutes}m` : "",
  ].filter(Boolean);

  return parts.join(" ");
}

function isNotFound(error: unknown) {
  return error instanceof ApiError && error.status === 404;
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  });
}

function credentialLabels(profile: AssetConnectionProfile) {
  return [
    profile.has_password ? "password" : "",
    profile.has_private_key ? "private key" : "",
    profile.has_passphrase ? "passphrase" : "",
  ].filter(Boolean);
}

function softwarePreview(software: string[]) {
  const visible = software.slice(0, 12);
  const extra = software.length - visible.length;

  return {
    visible,
    extra,
  };
}

function relationAssetLabel(name: string | undefined, id: string, type: string | undefined) {
  return {
    detail: type || id,
    title: name || id,
  };
}

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function CodeValue({ value }: { value: string | undefined }) {
  return value ? <code>{value}</code> : "-";
}

function RelationsSection({
  currentAssetID,
  error,
  isLoading,
  relations,
}: {
  currentAssetID: string;
  error: unknown;
  isLoading: boolean;
  relations: AssetRelation[] | undefined;
}) {
  const missing = isNotFound(error);
  const items = relations || [];

  return (
    <section className="drawer-section">
      <h3>Relations</h3>

      {isLoading ? <PanelState kind="loading" message="Loading asset relations" /> : null}

      {missing ? <PanelState kind="empty" message="No relations found." /> : null}

      {error && !missing ? (
        <PanelState kind="error" message={error instanceof Error ? error.message : "Failed to load relations."} />
      ) : null}

      {!isLoading && !error && items.length === 0 ? <PanelState kind="empty" message="No relations." /> : null}

      {items.length > 0 ? (
        <div className="request-list">
          {items.map((relation) => {
            const from = relationAssetLabel(relation.from_name, relation.from_asset_id, relation.from_type);
            const to = relationAssetLabel(relation.to_name, relation.to_asset_id, relation.to_type);
            const currentIsFrom = relation.from_asset_id === currentAssetID;
            return (
              <article className="request-row" key={relation.id}>
                <div className="request-main">
                  <div>
                    <h3>{relation.relation_type || "relation"}</h3>
                    <p>
                      <span className={currentIsFrom ? "relation-current" : ""}>{from.title}</span>
                      <span className="relation-arrow">to</span>
                      <span className={!currentIsFrom ? "relation-current" : ""}>{to.title}</span>
                    </p>
                  </div>
                  <span className={`status-pill ${sourceTone(relation.source)}`}>{relation.source || "manual"}</span>
                </div>
                <div className="request-meta">
                  <span>{from.detail}</span>
                  <span>{to.detail}</span>
                  <span>Updated {formatDateTime(relation.updated_at)}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function ProbeSection({
  error,
  isLoading,
  snapshot,
}: {
  error: unknown;
  isLoading: boolean;
  snapshot: AssetProbeSnapshot | undefined;
}) {
  const missing = isNotFound(error);
  const preview = snapshot ? softwarePreview(snapshot.software || []) : { visible: [], extra: 0 };

  return (
    <section className="drawer-section">
      <h3>Probe</h3>

      {isLoading ? <PanelState kind="loading" message="Loading latest probe" /> : null}

      {missing ? <PanelState kind="empty" message="No probe snapshot collected." /> : null}

      {error && !missing ? (
        <PanelState kind="error" message={error instanceof Error ? error.message : "Failed to load latest probe."} />
      ) : null}

      {snapshot ? (
        <>
          <dl className="detail-grid">
            <DetailItem label="Hostname">{snapshot.hostname || "-"}</DetailItem>
            <DetailItem label="OS">
              {[snapshot.os_name, snapshot.os_version].filter(Boolean).join(" ") || "-"}
            </DetailItem>
            <DetailItem label="Kernel">
              <CodeValue value={snapshot.kernel} />
            </DetailItem>
            <DetailItem label="Arch">{snapshot.arch || "-"}</DetailItem>
            <DetailItem label="Uptime">{formatUptimeSeconds(snapshot.uptime_seconds)}</DetailItem>
            <DetailItem label="CPU">
              {snapshot.cpu_model || "-"}
              {snapshot.cpu_cores ? <div className="muted">{snapshot.cpu_cores} cores</div> : null}
            </DetailItem>
            <DetailItem label="Memory">{formatMemoryMB(snapshot.memory_mb)}</DetailItem>
            <DetailItem label="Disk">{snapshot.disk_summary || "-"}</DetailItem>
            <DetailItem label="Collected by">{snapshot.collected_by || "-"}</DetailItem>
            <DetailItem label="Collected at">{formatDateTime(snapshot.collected_at)}</DetailItem>
          </dl>

          {preview.visible.length > 0 ? (
            <div className="chip-list">
              {preview.visible.map((item) => (
                <span className="chip" key={item}>
                  {item}
                </span>
              ))}
              {preview.extra > 0 ? <span className="muted">+{preview.extra} more</span> : null}
            </div>
          ) : (
            <div className="muted">No software inventory.</div>
          )}
        </>
      ) : null}
    </section>
  );
}

function ConnectionSection({
  asset,
  canWrite,
  error,
  isLoading,
  isSaving,
  isTesting,
  onSave,
  onTest,
  profile,
  saveError,
  testError,
  testResult,
}: {
  asset: Asset;
  canWrite: boolean;
  error: unknown;
  isLoading: boolean;
  isSaving: boolean;
  isTesting: boolean;
  onSave: (payload: UpdateAssetConnectionProfilePayload) => Promise<AssetConnectionProfile>;
  onTest: () => Promise<AssetConnectionTestResult>;
  profile: AssetConnectionProfile | undefined;
  saveError: unknown;
  testError: unknown;
  testResult: AssetConnectionTestResult | undefined;
}) {
  const missing = isNotFound(error);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ConnectionFormState>(() => connectionFormFromProfile(profile, asset));
  const [validationError, setValidationError] = useState("");
  const isDatabaseProtocol = form.protocol === "postgres";
  const isPasswordOnlyProtocol = form.protocol === "postgres" || form.protocol === "rdp";
  const authType = isPasswordOnlyProtocol ? "password" : form.authType;

  useEffect(() => {
    setForm(connectionFormFromProfile(profile, asset));
    setValidationError("");
    setEditing(false);
  }, [asset.id, profile?.asset_id, profile?.updated_at]);

  function updateForm<K extends keyof ConnectionFormState>(key: K, value: ConnectionFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateProtocol(protocol: string) {
    setForm((current) => ({
      ...current,
      authType: protocol === "postgres" || protocol === "rdp" ? "password" : current.authType || "password",
      database: protocol === "postgres" ? current.database : "",
      port: String(defaultConnectionPort(protocol)),
      protocol,
    }));
  }

  async function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = connectionFormToPayload(form);

    if (!payload.host) {
      setValidationError("Host is required.");
      return;
    }
    if (!payload.username) {
      setValidationError("Username is required.");
      return;
    }
    if (!Number.isFinite(payload.port) || payload.port <= 0) {
      setValidationError("Port must be a positive number.");
      return;
    }

    setValidationError("");
    try {
      const saved = await onSave(payload);
      setForm(connectionFormFromProfile(saved, asset));
      setEditing(false);
    } catch (_error) {
      // The mutation error is rendered by saveError so the form can stay open.
    }
  }

  return (
    <section className="drawer-section">
      <div className="drawer-section-header">
        <h3>Connection</h3>
        {canWrite ? (
          <div className="request-actions">
            {!editing && profile ? (
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => void onTest()}
                disabled={isTesting || isSaving}
              >
                {isTesting ? "Testing" : "Test connection"}
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => {
                setForm(connectionFormFromProfile(profile, asset));
                setValidationError("");
                setEditing((current) => !current);
              }}
              disabled={isSaving || isTesting}
            >
              {editing ? "Cancel" : profile ? "Edit" : "Create"}
            </button>
          </div>
        ) : null}
      </div>

      {isLoading ? <PanelState kind="loading" message="Loading connection profile" /> : null}

      {missing ? <PanelState kind="empty" message="No connection profile configured." /> : null}

      {error && !missing ? (
        <PanelState
          kind="error"
          message={error instanceof Error ? error.message : "Failed to load connection profile."}
        />
      ) : null}

      {validationError ? <PanelState kind="error" message={validationError} /> : null}

      {editing && saveError ? (
        <PanelState
          kind="error"
          message={saveError instanceof Error ? saveError.message : "Failed to save connection profile."}
        />
      ) : null}

      {!editing && testResult ? <PanelState kind="success" message="Connection test succeeded." /> : null}

      {!editing && testError ? (
        <PanelState
          kind="error"
          message={testError instanceof Error ? testError.message : "Connection test failed."}
        />
      ) : null}

      {editing ? (
        <form className="request-form" onSubmit={submitConnection}>
          <div className="form-grid">
            <label className="form-field">
              <span>Protocol</span>
              <select value={form.protocol} onChange={(event) => updateProtocol(event.target.value)}>
                <option value="ssh">ssh</option>
                <option value="postgres">postgres</option>
                <option value="rdp">rdp</option>
              </select>
            </label>

            <label className="form-field">
              <span>Host</span>
              <input value={form.host} onChange={(event) => updateForm("host", event.target.value)} />
            </label>

            <label className="form-field">
              <span>Port</span>
              <input
                type="number"
                min={1}
                value={form.port}
                onChange={(event) => updateForm("port", event.target.value)}
              />
            </label>

            <label className="form-field">
              <span>Username</span>
              <input value={form.username} onChange={(event) => updateForm("username", event.target.value)} />
            </label>

            {!isPasswordOnlyProtocol ? (
              <label className="form-field">
                <span>Auth type</span>
                <select value={form.authType} onChange={(event) => updateForm("authType", event.target.value)}>
                  <option value="password">password</option>
                  <option value="key">key</option>
                </select>
              </label>
            ) : null}

            {isDatabaseProtocol ? (
              <label className="form-field">
                <span>Database</span>
                <input
                  value={form.database}
                  onChange={(event) => updateForm("database", event.target.value)}
                  placeholder="postgres"
                />
              </label>
            ) : null}

            <label className="form-field">
              <span>Proxy ID</span>
              <input
                value={form.proxyID}
                onChange={(event) => updateForm("proxyID", event.target.value)}
                placeholder="direct connection"
              />
            </label>

            <label className="toggle-row form-toggle-row">
              <input
                type="checkbox"
                checked={form.bastionEnabled}
                onChange={(event) => updateForm("bastionEnabled", event.target.checked)}
              />
              <span>Bastion enabled</span>
            </label>
          </div>

          {authType === "password" ? (
            <label className="form-field">
              <span>Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(event) => updateForm("password", event.target.value)}
                placeholder={profile?.has_password ? "(unchanged)" : "enter password"}
              />
            </label>
          ) : (
            <>
              <label className="form-field">
                <span>Private key</span>
                <textarea
                  value={form.privateKey}
                  onChange={(event) => updateForm("privateKey", event.target.value)}
                  placeholder={profile?.has_private_key ? "(unchanged)" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                  rows={4}
                />
              </label>
              <label className="form-field">
                <span>Passphrase</span>
                <input
                  type="password"
                  value={form.passphrase}
                  onChange={(event) => updateForm("passphrase", event.target.value)}
                  placeholder={profile?.has_passphrase ? "(unchanged)" : "(optional)"}
                />
              </label>
            </>
          )}

          <div className="form-actions">
            <button type="submit" className="primary-button compact" disabled={isSaving}>
              {isSaving ? "Saving" : "Save connection"}
            </button>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => {
                setForm(connectionFormFromProfile(profile, asset));
                setValidationError("");
                setEditing(false);
              }}
              disabled={isSaving}
            >
              Cancel
            </button>
          </div>
          <div className="muted">Leave password and key fields blank to keep existing stored credentials.</div>
        </form>
      ) : null}

      {!editing && profile ? (
        <>
          <dl className="detail-grid">
            <DetailItem label="Protocol">{profile.protocol || "-"}</DetailItem>
            <DetailItem label="Host">
              <CodeValue value={profile.host} />
            </DetailItem>
            <DetailItem label="Port">{profile.port || "-"}</DetailItem>
            <DetailItem label="Username">{profile.username || "-"}</DetailItem>
            <DetailItem label="Auth type">{profile.auth_type || "-"}</DetailItem>
            <DetailItem label="Database">{profile.database || "-"}</DetailItem>
            <DetailItem label="Bastion enabled">{profile.bastion_enabled ? "yes" : "no"}</DetailItem>
            <DetailItem label="Proxy">
              {profile.proxy_name || profile.proxy_id || "-"}
              {profile.proxy_zone ? <div className="muted">{profile.proxy_zone}</div> : null}
            </DetailItem>
            <DetailItem label="Last probe status">{profile.last_probe_status || "-"}</DetailItem>
            <DetailItem label="Last probe at">{formatDateTime(profile.last_probe_at)}</DetailItem>
            <DetailItem label="Created">{formatDateTime(profile.created_at)}</DetailItem>
            <DetailItem label="Updated">{formatDateTime(profile.updated_at)}</DetailItem>
          </dl>

          {profile.last_probe_error ? <PanelState kind="error" message={profile.last_probe_error} /> : null}

          <div className="chip-list">
            {credentialLabels(profile).length > 0 ? (
              credentialLabels(profile).map((label) => (
                <span className="chip" key={label}>
                  {label}
                </span>
              ))
            ) : (
              <span className="muted">No stored credentials.</span>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function MetadataSection({ title, values }: { title: string; values: Record<string, unknown> | undefined }) {
  const entries = metadataEntries(values);

  return (
    <section className="drawer-section">
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <div className="muted">No metadata.</div>
      ) : (
        <div className="table-wrap">
          <table className="tag-table">
            <tbody>
              {entries.map(([key, value]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>
                    <code>{formatMetadataValue(value)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FilterSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All {label.toLowerCase()}</option>
        {options.map((option) => (
          <option value={option} key={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AssetsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const identity = auth.identity;
  const userID = identity?.user.id || "";
  const canReadAssets = auth.can("cmdb.asset:read");
  const canWriteAssets = auth.can("cmdb.asset:write");
  const [filters, setFilters] = useState<AssetFilters>(initialFilters);
  const [offset, setOffset] = useState(0);
  const [selectedAssetID, setSelectedAssetID] = useState("");
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>("summary");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerPanelRef = useRef<HTMLElement | null>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const options = useMemo(() => buildAssetListOptions(filters, offset), [filters, offset]);
  const assets = useQuery({
    queryKey: ["cmdb", "assets", "list", userID, options],
    queryFn: () => listAssets(options),
    enabled: canReadAssets && Boolean(userID),
  });
  const facets = useQuery({
    queryKey: ["cmdb", "assets", "facets", userID],
    queryFn: listAssetFacets,
    enabled: canReadAssets && Boolean(userID),
  });
  const assetDetail = useQuery({
    queryKey: ["cmdb", "assets", "detail", userID, selectedAssetID],
    queryFn: () => getAsset(selectedAssetID),
    enabled: canReadAssets && Boolean(userID) && Boolean(selectedAssetID),
  });
  const assetConnection = useQuery({
    queryKey: ["cmdb", "assets", "connection", userID, selectedAssetID],
    queryFn: () => getAssetConnectionProfile(selectedAssetID),
    enabled: canReadAssets && Boolean(userID) && Boolean(selectedAssetID),
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 1,
  });
  const assetProbe = useQuery({
    queryKey: ["cmdb", "assets", "probe", "latest", userID, selectedAssetID],
    queryFn: () => getLatestAssetProbe(selectedAssetID),
    enabled: canReadAssets && Boolean(userID) && Boolean(selectedAssetID),
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 1,
  });
  const assetRelations = useQuery({
    queryKey: ["cmdb", "assets", "relations", userID, selectedAssetID],
    queryFn: () => listAssetRelations(selectedAssetID),
    enabled: canReadAssets && Boolean(userID) && Boolean(selectedAssetID),
    retry: (failureCount, error) => !isNotFound(error) && failureCount < 1,
  });
  const saveConnection = useMutation({
    mutationFn: ({ assetID, payload }: { assetID: string; payload: UpdateAssetConnectionProfilePayload }) =>
      updateAssetConnectionProfile(assetID, payload),
    onSuccess: async (profile, variables) => {
      queryClient.setQueryData(["cmdb", "assets", "connection", userID, variables.assetID], profile);
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "connection", userID, variables.assetID] });
    },
  });
  const testConnection = useMutation({
    mutationFn: testAssetConnection,
    onSettled: async (_result, _error, assetID) => {
      if (!assetID) return;
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "connection", userID, assetID] });
    },
  });
  const items = assets.data?.items || [];
  const total = assets.data?.total || 0;
  const range = formatAssetRange(total, offset, items.length);
  const selectedAsset = assetDetail.data;
  const canGoPrevious = offset > 0;
  const canGoNext = offset + pageSize < total;
  const activeFilterCount = [
    filters.env,
    filters.query,
    filters.region,
    filters.source,
    filters.status,
    filters.type,
    filters.includeBastions ? "include-bastions" : "",
  ].filter(Boolean).length;

  function updateFilter<K extends keyof AssetFilters>(key: K, value: AssetFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setOffset(0);
  }

  function resetFilters() {
    setFilters(initialFilters);
    setOffset(0);
  }

  function closeAssetDetail() {
    setSelectedAssetID("");
  }

  useEffect(() => {
    if (!selectedAssetID) return;

    const restoreTarget = detailTriggerRef.current;
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
      if (!closeButtonRef.current) drawerPanelRef.current?.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedAssetID("");
        return;
      }

      if (event.key !== "Tab") return;

      const panel = drawerPanelRef.current;
      if (!panel) return;

      const candidates = focusableElements(panel);
      if (candidates.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = candidates[0];
      const last = candidates[candidates.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first || !panel.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      if (restoreTarget && document.contains(restoreTarget)) {
        window.setTimeout(() => restoreTarget.focus(), 0);
      }
    };
  }, [selectedAssetID]);

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Inventory</p>
          <h1>CMDB assets</h1>
        </div>
        <span className={`status-pill ${canReadAssets ? "ok" : "warn"}`}>
          <ShieldCheck size={14} aria-hidden="true" />
          {canReadAssets ? "cmdb.asset:read" : "Needs cmdb.asset:read"}
        </span>
      </div>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Assets</p>
            <h2>Inventory</h2>
          </div>
          <div className="panel-actions">
            <span className="status-pill">
              <Database size={14} aria-hidden="true" />
              {range}
            </span>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => void assets.refetch()}
              disabled={!canReadAssets || assets.isFetching}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>{assets.isFetching ? "Refreshing" : "Refresh"}</span>
            </button>
          </div>
        </div>

        {!canReadAssets ? <PanelState kind="permission" message="Permission required: cmdb.asset:read" /> : null}

        {canReadAssets && assets.isError ? (
          <PanelState
            kind="error"
            message={assets.error instanceof Error ? assets.error.message : "Failed to load assets."}
          />
        ) : null}

        {canReadAssets && facets.isError ? (
          <PanelState
            kind="error"
            message={facets.error instanceof Error ? facets.error.message : "Failed to load asset filters."}
          />
        ) : null}

        <div className="filter-panel">
          <label className="form-field search-field">
            <span>Search</span>
            <div className="input-with-icon">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={filters.query}
                onChange={(event) => updateFilter("query", event.target.value)}
                placeholder="Name, ID, IP, DNS"
                disabled={!canReadAssets}
              />
            </div>
          </label>

          <div className="form-grid compact-grid">
            <FilterSelect
              label="Env"
              value={filters.env}
              options={facetOptions(facets.data?.envs, filters.env)}
              onChange={(value) => updateFilter("env", value)}
            />
            <FilterSelect
              label="Type"
              value={filters.type}
              options={facetOptions(facets.data?.types, filters.type)}
              onChange={(value) => updateFilter("type", value)}
            />
            <FilterSelect
              label="Status"
              value={filters.status}
              options={facetOptions(facets.data?.statuses, filters.status)}
              onChange={(value) => updateFilter("status", value)}
            />
            <FilterSelect
              label="Source"
              value={filters.source}
              options={facetOptions(facets.data?.sources, filters.source)}
              onChange={(value) => updateFilter("source", value)}
            />
            <FilterSelect
              label="Region"
              value={filters.region}
              options={facetOptions(facets.data?.regions, filters.region)}
              onChange={(value) => updateFilter("region", value)}
            />
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={filters.includeBastions}
                onChange={(event) => updateFilter("includeBastions", event.target.checked)}
                disabled={!canReadAssets}
              />
              <span>Include VPC proxies</span>
            </label>
          </div>

          {activeFilterCount > 0 ? (
            <div className="filter-summary">
              <span className="status-pill info">{activeFilterCount} active</span>
              <button type="button" className="secondary-button compact" onClick={resetFilters}>
                <FilterX size={14} aria-hidden="true" />
                <span>Reset</span>
              </button>
            </div>
          ) : null}
        </div>

        {canReadAssets && assets.isLoading ? <PanelState kind="loading" message="Loading assets" /> : null}

        {canReadAssets && !assets.isLoading && !assets.isError && items.length === 0 ? (
          <PanelState
            kind="empty"
            message={activeFilterCount > 0 ? "No assets match the current filters." : "No assets yet."}
          />
        ) : null}

        {items.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Env</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Region</th>
                  <th>Network</th>
                  <th>Source</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <div className="asset-name-cell">
                        <strong>{asset.name || asset.id}</strong>
                        {asset.is_vpc_proxy ? <span className="status-pill ok">VPC proxy</span> : null}
                      </div>
                      {asset.private_dns ? <div className="muted">{asset.private_dns}</div> : null}
                    </td>
                    <td>{asset.type || "-"}</td>
                    <td>{asset.env || "default"}</td>
                    <td>
                      <span className={`status-pill ${statusTone(asset.status)}`}>{asset.status || "unknown"}</span>
                    </td>
                    <td>{asset.owner || "-"}</td>
                    <td>
                      <code>{asset.region || "-"}</code>
                      {asset.zone ? <div className="muted">{asset.zone}</div> : null}
                    </td>
                    <td>{networkText(asset)}</td>
                    <td>
                      <span className={`status-pill ${sourceTone(asset.source)}`}>{asset.source || "manual"}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={(event) => {
                          detailTriggerRef.current = event.currentTarget;
                          saveConnection.reset();
                          testConnection.reset();
                          setActiveDrawerTab("summary");
                          setSelectedAssetID(asset.id);
                        }}
                        aria-label={`View details for ${asset.name || asset.id}`}
                      >
                        <Eye size={14} aria-hidden="true" />
                        <span>Details</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {canReadAssets && total > pageSize ? (
          <div className="pagination-row">
            <span className="muted">Page size {pageSize}</span>
            <div className="request-actions">
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => setOffset((current) => previousAssetOffset(current, pageSize))}
                disabled={!canGoPrevious || assets.isFetching}
              >
                Previous
              </button>
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => setOffset((current) => nextAssetOffset(current, pageSize, total))}
                disabled={!canGoNext || assets.isFetching}
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </article>

      {canWriteAssets ? null : (
        <article className="work-panel">
          <PanelState kind="permission" message="Permission required for asset changes: cmdb.asset:write" />
        </article>
      )}

      {selectedAssetID ? (
        <div className="drawer-shell" role="presentation">
          <button
            type="button"
            className="drawer-backdrop"
            aria-label="Close asset details"
            onClick={closeAssetDetail}
          />
          <aside
            className="drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-detail-title"
            ref={drawerPanelRef}
            tabIndex={-1}
          >
            <header className="drawer-head">
              <div>
                <p className="eyebrow">{selectedAsset?.type || "Asset"}</p>
                <h2 id="asset-detail-title">{selectedAsset?.name || "Asset details"}</h2>
                <p className="muted">{selectedAsset?.external_id || selectedAssetID}</p>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={closeAssetDetail}
                title="Close"
                ref={closeButtonRef}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="drawer-body">
              {assetDetail.isLoading ? <PanelState kind="loading" message="Loading asset details" /> : null}

              {assetDetail.isError ? (
                <PanelState
                  kind="error"
                  message={
                    assetDetail.error instanceof Error ? assetDetail.error.message : "Failed to load asset details."
                  }
                />
              ) : null}

              {selectedAsset ? (
                <>
                  <div className="drawer-tabs" role="tablist" aria-label="Asset detail sections">
                    {drawerTabs.map((tab) => (
                      <button
                        type="button"
                        className={`drawer-tab${activeDrawerTab === tab.id ? " active" : ""}`}
                        key={tab.id}
                        role="tab"
                        aria-selected={activeDrawerTab === tab.id}
                        aria-controls={`asset-detail-${tab.id}`}
                        id={`asset-detail-tab-${tab.id}`}
                        onClick={() => setActiveDrawerTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div
                    className="drawer-tab-panel"
                    id={`asset-detail-${activeDrawerTab}`}
                    role="tabpanel"
                    aria-labelledby={`asset-detail-tab-${activeDrawerTab}`}
                  >
                    {activeDrawerTab === "summary" ? (
                      <>
                        <section className="drawer-section">
                          <h3>Summary</h3>
                          <dl className="detail-grid">
                            <DetailItem label="ID">
                              <code>{selectedAsset.id}</code>
                            </DetailItem>
                            <DetailItem label="Status">
                              <span className={`status-pill ${statusTone(selectedAsset.status)}`}>
                                {selectedAsset.status || "unknown"}
                              </span>
                            </DetailItem>
                            <DetailItem label="Criticality">{selectedAsset.criticality || "-"}</DetailItem>
                            <DetailItem label="Environment">{selectedAsset.env || "default"}</DetailItem>
                            <DetailItem label="Source">
                              <span className={`status-pill ${sourceTone(selectedAsset.source)}`}>
                                {selectedAsset.source || "manual"}
                              </span>
                            </DetailItem>
                            <DetailItem label="Created">{formatDateTime(selectedAsset.created_at)}</DetailItem>
                            <DetailItem label="Updated">{formatDateTime(selectedAsset.updated_at)}</DetailItem>
                            <DetailItem label="Expires">{formatDateTime(selectedAsset.expires_at)}</DetailItem>
                          </dl>
                        </section>

                        <section className="drawer-section">
                          <h3>Infrastructure</h3>
                          <dl className="detail-grid">
                            <DetailItem label="Region">
                              <CodeValue value={selectedAsset.region} />
                            </DetailItem>
                            <DetailItem label="Zone">
                              <CodeValue value={selectedAsset.zone} />
                            </DetailItem>
                            <DetailItem label="Account">
                              <CodeValue value={selectedAsset.account_id} />
                            </DetailItem>
                            <DetailItem label="Instance type">
                              <CodeValue value={selectedAsset.instance_type} />
                            </DetailItem>
                            <DetailItem label="OS image">
                              <CodeValue value={selectedAsset.os_image} />
                            </DetailItem>
                            <DetailItem label="OS family">{selectedAsset.os_family || "-"}</DetailItem>
                            <DetailItem label="AMI name">{selectedAsset.ami_name || "-"}</DetailItem>
                            <DetailItem label="VPC">
                              <CodeValue value={selectedAsset.vpc_id} />
                            </DetailItem>
                            <DetailItem label="Subnet">
                              <CodeValue value={selectedAsset.subnet_id} />
                            </DetailItem>
                            <DetailItem label="Key name">
                              <CodeValue value={selectedAsset.key_name} />
                            </DetailItem>
                          </dl>
                        </section>

                        <section className="drawer-section">
                          <h3>Network</h3>
                          <dl className="detail-grid">
                            <DetailItem label="Public IP">
                              <CodeValue value={selectedAsset.public_ip} />
                            </DetailItem>
                            <DetailItem label="Private IP">
                              <CodeValue value={selectedAsset.private_ip} />
                            </DetailItem>
                            <DetailItem label="Private DNS">
                              <CodeValue value={selectedAsset.private_dns} />
                            </DetailItem>
                            <DetailItem label="VPC proxy">{selectedAsset.is_vpc_proxy ? "yes" : "no"}</DetailItem>
                          </dl>
                        </section>

                        <section className="drawer-section">
                          <h3>Ownership</h3>
                          <dl className="detail-grid">
                            <DetailItem label="Owner">{selectedAsset.owner || "-"}</DetailItem>
                            <DetailItem label="Business unit">{selectedAsset.business_unit || "-"}</DetailItem>
                          </dl>
                        </section>
                      </>
                    ) : null}

                    {activeDrawerTab === "connection" ? (
                      <ConnectionSection
                        asset={selectedAsset}
                        canWrite={canWriteAssets}
                        error={assetConnection.error}
                        isLoading={assetConnection.isLoading}
                        isSaving={saveConnection.isPending}
                        isTesting={testConnection.isPending}
                        onSave={(payload) => saveConnection.mutateAsync({ assetID: selectedAsset.id, payload })}
                        onTest={() => testConnection.mutateAsync(selectedAsset.id)}
                        profile={assetConnection.data}
                        saveError={saveConnection.error}
                        testError={testConnection.error}
                        testResult={testConnection.data}
                      />
                    ) : null}

                    {activeDrawerTab === "probe" ? (
                      <ProbeSection error={assetProbe.error} isLoading={assetProbe.isLoading} snapshot={assetProbe.data} />
                    ) : null}

                    {activeDrawerTab === "relations" ? (
                      <RelationsSection
                        currentAssetID={selectedAsset.id}
                        error={assetRelations.error}
                        isLoading={assetRelations.isLoading}
                        relations={assetRelations.data}
                      />
                    ) : null}

                    {activeDrawerTab === "metadata" ? (
                      <>
                        <MetadataSection title="System tags" values={selectedAsset.system_tags} />
                        <MetadataSection title="Labels" values={selectedAsset.labels} />
                      </>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
