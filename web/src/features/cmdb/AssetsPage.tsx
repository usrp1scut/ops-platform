import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  Eye,
  FilterX,
  FolderTree,
  List,
  MonitorPlay,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError } from "../../api/client";
import {
  createAsset,
  deleteAsset,
  deleteAssetRelation,
  demoteAssetVPCProxy,
  getAsset,
  getAssetConnectionProfile,
  getLatestAssetProbe,
  listAssetRelations,
  listAssetFacets,
  listAssets,
  promoteAssetToVPCProxy,
  runAssetProbe,
  testAssetConnection,
  updateAsset,
  updateAssetConnectionProfile,
  type Asset,
  type AssetConnectionProfile,
  type AssetConnectionTestResult,
  type AssetProbeSnapshot,
  type AssetRelation,
  type CreateAssetPayload,
  type ListAssetsOptions,
  type PromoteVPCProxyOptions,
  type UpdateAssetConnectionProfilePayload,
  type UpdateAssetPayload,
} from "../../api/cmdb";
import { PanelState } from "../../components/PanelState";
import { formatAssetRange, nextAssetOffset, previousAssetOffset } from "../../lib/assets";
import {
  readAssetViewMode,
  writeAssetViewMode,
  type AssetViewMode,
} from "../../lib/assetView";
import {
  buildAssetTree,
  buildLaunchSearch,
  isConnectableAsset,
  type AssetTreeEnv,
  type LaunchProtocol,
} from "../../lib/launch";
import { useAuth } from "../auth/AuthProvider";
import { AssetForm } from "./AssetForm";

type ActionFeedback = {
  kind: "error" | "success";
  message: string;
};

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

// User-facing label for raw AWS resource type identifiers. The backend
// enums (`aws_ec2_instance` etc.) leak otherwise — operators shouldn't
// have to read snake_case API strings to know what they're looking at.
const FRIENDLY_TYPES: Record<string, string> = {
  aws_ec2_instance: "EC2 instance",
  aws_rds_instance: "RDS instance",
  aws_vpc: "VPC",
  aws_security_group: "Security group",
  aws_subnet: "Subnet",
  aws_elb: "Load balancer",
  aws_s3_bucket: "S3 bucket",
  aws_iam_role: "IAM role",
  aws_iam_user: "IAM user",
  aws_account: "AWS account",
  manual: "Manual host",
};
function friendlyType(asset: Asset): string {
  const raw = (asset.type || "manual").toLowerCase();
  return FRIENDLY_TYPES[raw] || asset.type || "Manual host";
}

// supportsTerminal narrows isConnectableAsset for the action column:
// SSH/RDP only render for resource types that actually have a shell or
// remote-desktop surface. RDS is connectable in the launch sense (DB) but
// shouldn't expose SSH/RDP buttons in the asset table.
function supportsTerminal(asset: Asset): boolean {
  const t = (asset.type || "").toLowerCase();
  return t === "aws_ec2_instance" || t === "manual" || t === "host" || t === "vm" || t === "";
}

// Best-effort connectivity hint derived from list-row data only. Probe
// state and saved-profile details would require an extra API; this column
// surfaces what we already have (bastion role, network-primitive flag,
// connectability heuristic) so the table conveys more than just AWS state.
function connectivityHint(asset: Asset): { label: string; tone: "ok" | "info" | "warn" | "" } {
  if (asset.is_vpc_proxy) return { label: "Bastion", tone: "ok" };
  if (!isConnectableAsset(asset)) return { label: "—", tone: "" };
  const t = (asset.type || "").toLowerCase();
  if (t === "aws_rds_instance") return { label: "DB target", tone: "info" };
  return { label: "Connectable", tone: "" };
}

// Compact "Region · Account" string. Both are short; collapsing them into
// one column reclaims width for IP/DNS/Actions on table-heavy pages.
function regionAccountCell(asset: Asset): { region: string; sub: string } {
  return {
    region: asset.region || "-",
    sub: [asset.zone, asset.account_id].filter(Boolean).join(" · "),
  };
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
  canWrite,
  currentAssetID,
  deleteError,
  deletingID,
  error,
  isLoading,
  onDelete,
  relations,
}: {
  canWrite: boolean;
  currentAssetID: string;
  deleteError: unknown;
  deletingID: string;
  error: unknown;
  isLoading: boolean;
  onDelete: (relation: AssetRelation) => void;
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

      {deleteError ? (
        <PanelState
          kind="error"
          message={deleteError instanceof Error ? deleteError.message : "Failed to remove relation."}
        />
      ) : null}

      {!isLoading && !error && items.length === 0 ? <PanelState kind="empty" message="No relations." /> : null}

      {items.length > 0 ? (
        <div className="request-list">
          {items.map((relation) => {
            const from = relationAssetLabel(relation.from_name, relation.from_asset_id, relation.from_type);
            const to = relationAssetLabel(relation.to_name, relation.to_asset_id, relation.to_type);
            const currentIsFrom = relation.from_asset_id === currentAssetID;
            const isDeleting = deletingID === relation.id;
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
                  <div className="request-status-actions">
                    <span className={`status-pill ${sourceTone(relation.source)}`}>
                      {relation.source || "manual"}
                    </span>
                    {canWrite ? (
                      <button
                        type="button"
                        className="secondary-button compact"
                        onClick={() => onDelete(relation)}
                        disabled={isDeleting}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        <span>{isDeleting ? "Removing" : "Forget"}</span>
                      </button>
                    ) : null}
                  </div>
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
  canWrite,
  error,
  isLoading,
  isRunning,
  onRun,
  runError,
  snapshot,
}: {
  canWrite: boolean;
  error: unknown;
  isLoading: boolean;
  isRunning: boolean;
  onRun: () => void;
  runError: unknown;
  snapshot: AssetProbeSnapshot | undefined;
}) {
  const missing = isNotFound(error);
  const preview = snapshot ? softwarePreview(snapshot.software || []) : { visible: [], extra: 0 };

  return (
    <section className="drawer-section">
      <div className="drawer-section-header">
        <h3>Probe</h3>
        {canWrite ? (
          <button
            type="button"
            className="secondary-button compact"
            onClick={onRun}
            disabled={isRunning || isLoading}
          >
            <Play size={14} aria-hidden="true" />
            <span>{isRunning ? "Probing" : "Run probe now"}</span>
          </button>
        ) : null}
      </div>

      {isLoading ? <PanelState kind="loading" message="Loading latest probe" /> : null}

      {missing ? <PanelState kind="empty" message="No probe snapshot collected." /> : null}

      {error && !missing ? (
        <PanelState kind="error" message={error instanceof Error ? error.message : "Failed to load latest probe."} />
      ) : null}

      {runError ? (
        <PanelState kind="error" message={runError instanceof Error ? runError.message : "Probe run failed."} />
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

function VPCProxyControl({
  asset,
  canWrite,
  feedback,
  isDemoting,
  isPromoting,
  onDemote,
  onPromote,
}: {
  asset: Asset;
  canWrite: boolean;
  feedback: ActionFeedback | null;
  isDemoting: boolean;
  isPromoting: boolean;
  onDemote: () => void;
  onPromote: () => void;
}) {
  const isProxy = Boolean(asset.is_vpc_proxy);

  return (
    <section className="drawer-section">
      <div className="drawer-section-header">
        <h3>VPC proxy</h3>
        <span className={`status-pill ${isProxy ? "ok" : ""}`}>{isProxy ? "promoted" : "regular asset"}</span>
      </div>

      {feedback ? <PanelState kind={feedback.kind} message={feedback.message} /> : null}

      <p className="muted">
        {isProxy
          ? "This asset acts as an SSH bastion. Demoting removes its SSH proxy registration but keeps the asset record."
          : "Promote this asset to an SSH bastion proxy so other assets in the same VPC can connect through it."}
      </p>

      {canWrite ? (
        <div className="form-actions">
          {isProxy ? (
            <button
              type="button"
              className="secondary-button compact"
              onClick={onDemote}
              disabled={isDemoting || isPromoting}
            >
              <ArrowDownToLine size={14} aria-hidden="true" />
              <span>{isDemoting ? "Demoting" : "Demote"}</span>
            </button>
          ) : (
            <button
              type="button"
              className="primary-button compact"
              onClick={onPromote}
              disabled={isPromoting || isDemoting}
            >
              <ArrowUpFromLine size={14} aria-hidden="true" />
              <span>{isPromoting ? "Promoting" : "Promote"}</span>
            </button>
          )}
        </div>
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

// Shared SSH / RDP / Details cluster so the flat table and the tree view
// expose identical actions and behaviour.
function AssetActions({
  asset,
  showTerminal,
  onConnect,
  onDetails,
}: {
  asset: Asset;
  showTerminal: boolean;
  onConnect: (asset: Asset, protocol: LaunchProtocol) => void;
  onDetails: (asset: Asset, trigger: HTMLButtonElement) => void;
}) {
  return (
    <div className="request-actions">
      {showTerminal ? (
        <>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => onConnect(asset, "ssh")}
            aria-label={`Open SSH session to ${asset.name || asset.id}`}
            title="Open SSH terminal in Sessions"
          >
            <SquareTerminal size={14} aria-hidden="true" />
            <span>SSH</span>
          </button>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => onConnect(asset, "rdp")}
            aria-label={`Open RDP session to ${asset.name || asset.id}`}
            title="Open RDP session in Sessions"
          >
            <MonitorPlay size={14} aria-hidden="true" />
            <span>RDP</span>
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="secondary-button compact"
        onClick={(event) => onDetails(asset, event.currentTarget)}
        aria-label={`View details for ${asset.name || asset.id}`}
      >
        <Eye size={14} aria-hidden="true" />
        <span>Details</span>
      </button>
    </div>
  );
}

export function AssetsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const identity = auth.identity;
  const userID = identity?.user.id || "";
  const canReadAssets = auth.can("cmdb.asset:read");
  const canWriteAssets = auth.can("cmdb.asset:write");

  function connectAsset(asset: Asset, protocol: LaunchProtocol) {
    // Hand the actual launch off to the Sessions page so the live tabs
    // render in the same place no matter how the operator started the
    // session. This mirrors the legacy classic-script portal where the
    // CMDB Connect button always materialised on the Sessions view.
    navigate(`/sessions${buildLaunchSearch({ assetID: asset.id, protocol })}`);
  }
  // CMDB inventory is a wide-table page; opt the section into the
  // fullwidth shell so the table can use the available width and Actions
  // stop getting clipped on standard monitors. Sessions Live mode uses a
  // separate `workspace-mode` class — they coexist without conflict.
  useEffect(() => {
    document.body.classList.add("fullwidth-mode");
    return () => {
      document.body.classList.remove("fullwidth-mode");
    };
  }, []);

  const [filters, setFilters] = useState<AssetFilters>(initialFilters);
  const [offset, setOffset] = useState(0);
  const [viewMode, setViewModeState] = useState<AssetViewMode>(() => readAssetViewMode());
  const [selectedAssetID, setSelectedAssetID] = useState("");
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>("summary");
  const [creating, setCreating] = useState(false);
  const [editingAsset, setEditingAsset] = useState(false);
  const [assetFeedback, setAssetFeedback] = useState<ActionFeedback | null>(null);
  const [vpcProxyFeedback, setVpcProxyFeedback] = useState<ActionFeedback | null>(null);
  const [deletingRelationID, setDeletingRelationID] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerPanelRef = useRef<HTMLElement | null>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const options = useMemo(() => buildAssetListOptions(filters, offset), [filters, offset]);
  const assets = useQuery({
    queryKey: ["cmdb", "assets", "list", userID, options],
    queryFn: () => listAssets(options),
    enabled: canReadAssets && Boolean(userID) && viewMode === "list",
  });
  // Tree view groups the *whole* filtered set client-side (env -> vpc),
  // so it pulls a wide window instead of a 25-row page. Mirrors the
  // legacy portal's limit:500 grouping. Only runs while tree is active.
  const treeOptions = useMemo<ListAssetsOptions>(
    () => ({ ...buildAssetListOptions(filters, 0), limit: 500 }),
    [filters],
  );
  const assetsTree = useQuery({
    queryKey: ["cmdb", "assets", "tree", userID, treeOptions],
    queryFn: () => listAssets(treeOptions),
    enabled: canReadAssets && Boolean(userID) && viewMode === "tree",
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
  const createAssetMutation = useMutation({
    mutationFn: (payload: CreateAssetPayload) => createAsset(payload),
    onMutate: () => {
      setAssetFeedback(null);
    },
    onSuccess: async (asset) => {
      setCreating(false);
      setAssetFeedback({ kind: "success", message: `Asset created: ${asset.name || asset.id}.` });
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "list"] });
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "facets"] });
      setActiveDrawerTab("summary");
      setEditingAsset(false);
      setSelectedAssetID(asset.id);
    },
    onError: (error) => {
      setAssetFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to create asset.",
      });
    },
  });
  const updateAssetMutation = useMutation({
    mutationFn: ({ assetID, payload }: { assetID: string; payload: UpdateAssetPayload }) =>
      updateAsset(assetID, payload),
    onMutate: () => {
      setAssetFeedback(null);
    },
    onSuccess: async (asset, variables) => {
      setEditingAsset(false);
      setAssetFeedback({ kind: "success", message: `Asset updated: ${asset.name || asset.id}.` });
      queryClient.setQueryData(["cmdb", "assets", "detail", userID, variables.assetID], asset);
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "list"] });
    },
    onError: (error) => {
      setAssetFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to update asset.",
      });
    },
  });
  const deleteAssetMutation = useMutation({
    mutationFn: (assetID: string) => deleteAsset(assetID),
    onMutate: () => {
      setAssetFeedback(null);
    },
    onSuccess: async (_result, assetID) => {
      setSelectedAssetID("");
      setEditingAsset(false);
      setAssetFeedback({ kind: "success", message: "Asset deleted." });
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "list"] });
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "facets"] });
      queryClient.removeQueries({ queryKey: ["cmdb", "assets", "detail", userID, assetID] });
    },
    onError: (error) => {
      setAssetFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to delete asset.",
      });
    },
  });
  const runProbeMutation = useMutation({
    mutationFn: (assetID: string) => runAssetProbe(assetID),
    onSuccess: (snapshot, assetID) => {
      queryClient.setQueryData(["cmdb", "assets", "probe", "latest", userID, assetID], snapshot);
    },
    onSettled: async (_result, _error, assetID) => {
      if (!assetID) return;
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "probe", "latest", userID, assetID] });
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "connection", userID, assetID] });
    },
  });
  const promoteVPCProxyMutation = useMutation({
    mutationFn: ({ assetID, options }: { assetID: string; options: PromoteVPCProxyOptions }) =>
      promoteAssetToVPCProxy(assetID, options),
    onMutate: () => {
      setVpcProxyFeedback(null);
    },
    onSuccess: async (result, variables) => {
      setVpcProxyFeedback({
        kind: "success",
        message: `Promoted to SSH proxy: ${result.proxy.name}.`,
      });
      queryClient.setQueryData(["cmdb", "assets", "detail", userID, variables.assetID], result.asset);
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "list"] });
      await queryClient.invalidateQueries({ queryKey: ["connectivity"] });
    },
    onError: (error) => {
      setVpcProxyFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to promote VPC proxy.",
      });
    },
  });
  const demoteVPCProxyMutation = useMutation({
    mutationFn: (assetID: string) => demoteAssetVPCProxy(assetID),
    onMutate: () => {
      setVpcProxyFeedback(null);
    },
    onSuccess: async (_result, assetID) => {
      setVpcProxyFeedback({ kind: "success", message: "VPC proxy demoted." });
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "list"] });
      await queryClient.invalidateQueries({ queryKey: ["cmdb", "assets", "detail", userID, assetID] });
      await queryClient.invalidateQueries({ queryKey: ["connectivity"] });
    },
    onError: (error) => {
      setVpcProxyFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to demote VPC proxy.",
      });
    },
  });
  const deleteRelationMutation = useMutation({
    mutationFn: ({ assetID, relationID }: { assetID: string; relationID: string }) =>
      deleteAssetRelation(assetID, relationID),
    onMutate: ({ relationID }) => {
      setDeletingRelationID(relationID);
    },
    onSettled: async (_result, _error, variables) => {
      setDeletingRelationID("");
      if (!variables) return;
      await queryClient.invalidateQueries({
        queryKey: ["cmdb", "assets", "relations", userID, variables.assetID],
      });
    },
  });
  const items = assets.data?.items || [];
  const total = assets.data?.total || 0;
  const range = formatAssetRange(total, offset, items.length);
  const treeItems = useMemo(() => assetsTree.data?.items || [], [assetsTree.data]);
  const assetTree: AssetTreeEnv[] = useMemo(() => buildAssetTree(treeItems), [treeItems]);
  const selectedAsset = assetDetail.data;
  const canGoPrevious = offset > 0;
  const canGoNext = offset + pageSize < total;

  function setViewMode(next: AssetViewMode) {
    setViewModeState(next);
    writeAssetViewMode(next);
  }

  function openAssetDetails(asset: Asset, trigger: HTMLButtonElement) {
    detailTriggerRef.current = trigger;
    saveConnection.reset();
    testConnection.reset();
    setActiveDrawerTab("summary");
    setSelectedAssetID(asset.id);
  }
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

  function confirmDeleteAsset(asset: Asset) {
    if (
      !window.confirm(
        `Delete asset "${asset.name || asset.id}"? Connection profile, probe history, and relations will be removed.`,
      )
    ) {
      return;
    }
    deleteAssetMutation.mutate(asset.id);
  }

  function confirmDemoteVPCProxy(asset: Asset) {
    if (
      !window.confirm(
        `Demote "${asset.name || asset.id}" from SSH proxy? Assets routed through it will lose proxy connectivity.`,
      )
    ) {
      return;
    }
    demoteVPCProxyMutation.mutate(asset.id);
  }

  function confirmDeleteRelation(assetID: string, relation: AssetRelation) {
    if (!window.confirm(`Forget the "${relation.relation_type || "relation"}" link?`)) return;
    deleteRelationMutation.mutate({ assetID, relationID: relation.id });
  }

  useEffect(() => {
    setEditingAsset(false);
    setVpcProxyFeedback(null);
    saveConnection.reset();
    testConnection.reset();
    runProbeMutation.reset();
    promoteVPCProxyMutation.reset();
    demoteVPCProxyMutation.reset();
    // Intentionally only depend on selectedAssetID — the mutation refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssetID]);

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
        <div className="request-actions">
          <span className={`status-pill ${canReadAssets ? "ok" : "warn"}`}>
            <ShieldCheck size={14} aria-hidden="true" />
            {canReadAssets ? "cmdb.asset:read" : "Needs cmdb.asset:read"}
          </span>
          {canWriteAssets ? (
            <button
              type="button"
              className="primary-button compact"
              onClick={() => {
                setCreating((current) => !current);
                setAssetFeedback(null);
                createAssetMutation.reset();
              }}
            >
              <Plus size={14} aria-hidden="true" />
              <span>{creating ? "Hide form" : "New asset"}</span>
            </button>
          ) : null}
        </div>
      </div>

      {assetFeedback ? <PanelState kind={assetFeedback.kind} message={assetFeedback.message} /> : null}

      {creating && canWriteAssets ? (
        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Create</p>
              <h2>New asset</h2>
            </div>
            <span className="status-pill">cmdb.asset:write</span>
          </div>
          <AssetForm
            mode="create"
            onCancel={() => {
              setCreating(false);
              createAssetMutation.reset();
            }}
            onSubmitCreate={(payload) => createAssetMutation.mutate(payload)}
            submitError={createAssetMutation.error}
            submitting={createAssetMutation.isPending}
          />
        </article>
      ) : null}

      <article className="work-panel assets-panel">
        {/* Inner header collapses into a single toolbar row: search wide,
            5 facet selects, the bastion toggle, count pill, refresh.
            Drops the redundant "Assets / Inventory" eyebrow since the page
            header already names this section. */}
        <div className="assets-toolbar">
          <label className="form-field search-field assets-toolbar-search">
            <span className="sr-only">Search</span>
            <div className="input-with-icon">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={filters.query}
                onChange={(event) => updateFilter("query", event.target.value)}
                placeholder="Search name, ID, IP, DNS"
                disabled={!canReadAssets}
              />
            </div>
          </label>

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
          <label className="assets-toolbar-toggle">
            <input
              type="checkbox"
              checked={filters.includeBastions}
              onChange={(event) => updateFilter("includeBastions", event.target.checked)}
              disabled={!canReadAssets}
            />
            <span>Include VPC proxies</span>
          </label>

          <div className="assets-toolbar-spacer" />

          {activeFilterCount > 0 ? (
            <button type="button" className="secondary-button compact" onClick={resetFilters}>
              <FilterX size={14} aria-hidden="true" />
              <span>Reset {activeFilterCount}</span>
            </button>
          ) : null}
          <div className="view-toggle" role="group" aria-label="Asset view mode">
            <button
              type="button"
              className={`view-toggle-btn${viewMode === "list" ? " active" : ""}`}
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              title="Flat table"
            >
              <List size={14} aria-hidden="true" />
              <span>List</span>
            </button>
            <button
              type="button"
              className={`view-toggle-btn${viewMode === "tree" ? " active" : ""}`}
              onClick={() => setViewMode("tree")}
              aria-pressed={viewMode === "tree"}
              title="Group by env / VPC"
            >
              <FolderTree size={14} aria-hidden="true" />
              <span>Tree</span>
            </button>
          </div>
          <span className="status-pill">
            <Database size={14} aria-hidden="true" />
            {viewMode === "tree" ? `${treeItems.length} grouped` : range}
          </span>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => void (viewMode === "tree" ? assetsTree.refetch() : assets.refetch())}
            disabled={
              !canReadAssets || (viewMode === "tree" ? assetsTree.isFetching : assets.isFetching)
            }
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>
              {(viewMode === "tree" ? assetsTree.isFetching : assets.isFetching)
                ? "Refreshing"
                : "Refresh"}
            </span>
          </button>
        </div>

        {!canReadAssets ? <PanelState kind="permission" message="Permission required: cmdb.asset:read" /> : null}

        {canReadAssets && viewMode === "list" && assets.isError ? (
          <PanelState
            kind="error"
            message={assets.error instanceof Error ? assets.error.message : "Failed to load assets."}
          />
        ) : null}

        {canReadAssets && viewMode === "tree" && assetsTree.isError ? (
          <PanelState
            kind="error"
            message={assetsTree.error instanceof Error ? assetsTree.error.message : "Failed to load assets."}
          />
        ) : null}

        {canReadAssets && facets.isError ? (
          <PanelState
            kind="error"
            message={facets.error instanceof Error ? facets.error.message : "Failed to load asset filters."}
          />
        ) : null}

        {canReadAssets && viewMode === "list" && assets.isLoading ? (
          <PanelState kind="loading" message="Loading assets" />
        ) : null}

        {canReadAssets && viewMode === "tree" && assetsTree.isLoading ? (
          <PanelState kind="loading" message="Loading assets" />
        ) : null}

        {canReadAssets && viewMode === "list" && !assets.isLoading && !assets.isError && items.length === 0 ? (
          <PanelState
            kind="empty"
            message={activeFilterCount > 0 ? "No assets match the current filters." : "No assets yet."}
          />
        ) : null}

        {canReadAssets &&
        viewMode === "tree" &&
        !assetsTree.isLoading &&
        !assetsTree.isError &&
        treeItems.length === 0 ? (
          <PanelState
            kind="empty"
            message={activeFilterCount > 0 ? "No assets match the current filters." : "No assets yet."}
          />
        ) : null}

        {viewMode === "tree" && treeItems.length > 0 ? (
          <div className="asset-tree assets-tree-view">
            {assetTree.map((env) => (
              <details className="asset-tree-env" key={env.envName} open>
                <summary>
                  <span>env · {env.envName}</span>
                  <span className="muted">({env.total})</span>
                </summary>
                {env.vpcs.map((vpc) => (
                  <details className="asset-tree-vpc" key={`${env.envName}::${vpc.vpcKey}`} open>
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
                          <div
                            className={`asset-tree-leaf${asset.is_vpc_proxy ? " bastion" : ""}`}
                            key={asset.id}
                          >
                            <div className="asset-tree-leaf-main">
                              <span className="asset-tree-name">{asset.name || asset.id}</span>
                              {asset.is_vpc_proxy ? (
                                <span className="status-pill ok tiny">bastion</span>
                              ) : null}
                              <span className={`status-pill ${statusTone(asset.status)} tiny`}>
                                {asset.status || "unknown"}
                              </span>
                              <span className="asset-tree-meta">{friendlyType(asset)}</span>
                              {addr ? <span className="asset-tree-addr">{addr}</span> : null}
                            </div>
                            <AssetActions
                              asset={asset}
                              showTerminal={supportsTerminal(asset)}
                              onConnect={connectAsset}
                              onDetails={openAssetDetails}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ))}
              </details>
            ))}
          </div>
        ) : null}

        {viewMode === "list" && items.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table assets-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Kind</th>
                  <th>Address</th>
                  <th>Env</th>
                  <th>Region · Account</th>
                  <th>State</th>
                  <th>Connectivity</th>
                  <th>Owner</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((asset) => {
                  const region = regionAccountCell(asset);
                  const conn = connectivityHint(asset);
                  const showTerminal = supportsTerminal(asset);
                  return (
                    <tr key={asset.id}>
                      <td>
                        <div className="asset-name-cell">
                          <strong>{asset.name || asset.id}</strong>
                          {asset.is_vpc_proxy ? <span className="status-pill ok tiny">bastion</span> : null}
                        </div>
                        {asset.private_dns ? <div className="muted small">{asset.private_dns}</div> : null}
                      </td>
                      <td className="nowrap">{friendlyType(asset)}</td>
                      <td>
                        {asset.public_ip ? <div><code>{asset.public_ip}</code> <span className="muted">pub</span></div> : null}
                        {asset.private_ip ? <div><code>{asset.private_ip}</code> <span className="muted">priv</span></div> : null}
                        {!asset.public_ip && !asset.private_ip ? <span className="muted">—</span> : null}
                      </td>
                      <td className="nowrap">{asset.env || "default"}</td>
                      <td className="nowrap">
                        <code>{region.region}</code>
                        {region.sub ? <div className="muted small">{region.sub}</div> : null}
                      </td>
                      <td className="nowrap">
                        <span className={`status-pill ${statusTone(asset.status)}`}>{asset.status || "unknown"}</span>
                      </td>
                      <td className="nowrap">
                        {conn.tone ? (
                          <span className={`status-pill ${conn.tone}`}>{conn.label}</span>
                        ) : (
                          <span className="muted">{conn.label}</span>
                        )}
                        <div className="muted small">{(asset.source || "manual")}</div>
                      </td>
                      <td className="nowrap">{asset.owner || <span className="muted">—</span>}</td>
                      <td className="col-actions">
                        <AssetActions
                          asset={asset}
                          showTerminal={showTerminal}
                          onConnect={connectAsset}
                          onDetails={openAssetDetails}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {canReadAssets && viewMode === "list" && total > pageSize ? (
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
              <div className="request-actions">
                {canWriteAssets && selectedAsset ? (
                  <>
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => {
                        setActiveDrawerTab("summary");
                        setEditingAsset((current) => !current);
                        updateAssetMutation.reset();
                      }}
                      disabled={updateAssetMutation.isPending}
                    >
                      <Pencil size={14} aria-hidden="true" />
                      <span>{editingAsset ? "Cancel edit" : "Edit"}</span>
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact"
                      onClick={() => confirmDeleteAsset(selectedAsset)}
                      disabled={deleteAssetMutation.isPending}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span>{deleteAssetMutation.isPending ? "Deleting" : "Delete"}</span>
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="icon-button"
                  onClick={closeAssetDetail}
                  title="Close"
                  ref={closeButtonRef}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
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
                    {activeDrawerTab === "summary" && editingAsset ? (
                      <section className="drawer-section">
                        <h3>Edit asset</h3>
                        <AssetForm
                          asset={selectedAsset}
                          mode="edit"
                          onCancel={() => {
                            setEditingAsset(false);
                            updateAssetMutation.reset();
                          }}
                          onSubmitUpdate={(payload) =>
                            updateAssetMutation.mutate({ assetID: selectedAsset.id, payload })
                          }
                          submitError={updateAssetMutation.error}
                          submitting={updateAssetMutation.isPending}
                        />
                      </section>
                    ) : null}

                    {activeDrawerTab === "summary" && !editingAsset ? (
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
                      <>
                        <VPCProxyControl
                          asset={selectedAsset}
                          canWrite={canWriteAssets}
                          feedback={vpcProxyFeedback}
                          isDemoting={demoteVPCProxyMutation.isPending}
                          isPromoting={promoteVPCProxyMutation.isPending}
                          onDemote={() => confirmDemoteVPCProxy(selectedAsset)}
                          onPromote={() =>
                            promoteVPCProxyMutation.mutate({ assetID: selectedAsset.id, options: {} })
                          }
                        />
                        <ConnectionSection
                          asset={selectedAsset}
                          canWrite={canWriteAssets}
                          error={assetConnection.error}
                          isLoading={assetConnection.isLoading}
                          isSaving={saveConnection.isPending}
                          isTesting={testConnection.isPending}
                          onSave={(payload) =>
                            saveConnection.mutateAsync({ assetID: selectedAsset.id, payload })
                          }
                          onTest={() => testConnection.mutateAsync(selectedAsset.id)}
                          profile={assetConnection.data}
                          saveError={saveConnection.error}
                          testError={testConnection.error}
                          testResult={testConnection.data}
                        />
                      </>
                    ) : null}

                    {activeDrawerTab === "probe" ? (
                      <ProbeSection
                        canWrite={canWriteAssets}
                        error={assetProbe.error}
                        isLoading={assetProbe.isLoading}
                        isRunning={runProbeMutation.isPending}
                        onRun={() => runProbeMutation.mutate(selectedAsset.id)}
                        runError={runProbeMutation.error}
                        snapshot={assetProbe.data}
                      />
                    ) : null}

                    {activeDrawerTab === "relations" ? (
                      <RelationsSection
                        canWrite={canWriteAssets}
                        currentAssetID={selectedAsset.id}
                        deleteError={deleteRelationMutation.error}
                        deletingID={deletingRelationID}
                        error={assetRelations.error}
                        isLoading={assetRelations.isLoading}
                        onDelete={(relation) => confirmDeleteRelation(selectedAsset.id, relation)}
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
