import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Fingerprint, Network, Plus, RefreshCw, Route, Save, Search, ShieldCheck, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import {
  approveHostKeyOverride,
  createSSHProxy,
  deleteHostKey,
  deleteSSHProxy,
  listHostKeys,
  listSSHProxies,
  updateSSHProxy,
  type HostKeyRecord,
  type HostKeyScope,
  type SSHProxy,
} from "../../api/connectivity";
import { PanelState } from "../../components/PanelState";
import { PermissionList } from "../../components/PermissionList";
import {
  emptySSHProxyForm,
  filterHostKeys,
  hostKeyCounts,
  hostKeyStatusTone,
  sshProxyCredentialLabels,
  sshProxyFormToPayload,
  sshProxyToForm,
  validateSSHProxyForm,
  type SSHProxyFormMode,
  type SSHProxyFormState,
} from "../../lib/connectivity";
import { useAuth } from "../auth/AuthProvider";

type ActionFeedback = {
  kind: "error" | "success";
  message: string;
};

type ConnectivityTab = "proxies" | "hostkeys";

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function proxyEndpoint(proxy: SSHProxy) {
  return `${proxy.host}:${proxy.port || 22}`;
}

function hostKeyEndpoint(record: HostKeyRecord) {
  return `${record.host}:${record.port || 22}`;
}

function hostKeyTargetLabel(record: HostKeyRecord) {
  return record.target_name || record.target_id;
}

function updateForm<K extends keyof SSHProxyFormState>(
  setForm: (updater: (current: SSHProxyFormState) => SSHProxyFormState) => void,
  key: K,
  value: SSHProxyFormState[K],
) {
  setForm((current) => ({ ...current, [key]: value }));
}

function credentialChips(proxy: SSHProxy) {
  const labels = sshProxyCredentialLabels(proxy);
  if (labels.length === 0) return <span className="muted">none</span>;

  return (
    <div className="chip-list">
      {labels.map((label) => (
        <span className="chip" key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}

export function ConnectivityPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const userID = auth.identity?.user.id || "";
  const canReadAssets = auth.can("cmdb.asset:read");
  const canWriteAssets = auth.can("cmdb.asset:write");
  const connectivityPermissions = (auth.identity?.permissions || []).filter((permission) =>
    permission.startsWith("cmdb.asset:"),
  );
  const connectivityRootKey = ["connectivity", userID] as const;
  const [formMode, setFormMode] = useState<SSHProxyFormMode>("create");
  const [form, setForm] = useState<SSHProxyFormState>(emptySSHProxyForm);
  const [activeTab, setActiveTab] = useState<ConnectivityTab>("proxies");
  const [hostKeyScope, setHostKeyScope] = useState<"all" | HostKeyScope>("all");
  const [hostKeyQuery, setHostKeyQuery] = useState("");
  const [selectedProxyID, setSelectedProxyID] = useState("");
  const [validationError, setValidationError] = useState("");
  const [formFeedback, setFormFeedback] = useState<ActionFeedback | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<ActionFeedback | null>(null);
  const [hostKeyFeedback, setHostKeyFeedback] = useState<ActionFeedback | null>(null);

  const proxies = useQuery({
    queryKey: [...connectivityRootKey, "ssh-proxies"],
    queryFn: listSSHProxies,
    enabled: canReadAssets && Boolean(userID),
  });
  const hostKeys = useQuery({
    queryKey: [...connectivityRootKey, "hostkeys"],
    queryFn: listHostKeys,
    enabled: canReadAssets && Boolean(userID),
  });
  const proxyItems = proxies.data?.items || [];
  const hostKeyItems = hostKeys.data?.items || [];
  const selectedProxy = proxyItems.find((proxy) => proxy.id === selectedProxyID);
  const zoneCount = new Set(proxyItems.map((proxy) => proxy.network_zone).filter(Boolean)).size;
  const keyAuthCount = proxyItems.filter((proxy) => proxy.auth_type === "key").length;
  const hostKeyStats = hostKeyCounts(hostKeyItems);
  const filteredHostKeys = useMemo(
    () => filterHostKeys(hostKeyItems, { query: hostKeyQuery, scope: hostKeyScope }),
    [hostKeyItems, hostKeyQuery, hostKeyScope],
  );

  const createProxy = useMutation({
    mutationFn: createSSHProxy,
    onMutate: () => {
      setFormFeedback(null);
    },
    onSuccess: async (proxy) => {
      setForm(sshProxyToForm(proxy));
      setFormMode("edit");
      setSelectedProxyID(proxy.id);
      setFormFeedback({ kind: "success", message: `SSH proxy created: ${proxy.name}.` });
      await queryClient.invalidateQueries({ queryKey: connectivityRootKey });
    },
    onError: (error) => {
      setFormFeedback({ kind: "error", message: error instanceof Error ? error.message : "Failed to create proxy." });
    },
  });

  const updateProxy = useMutation({
    mutationFn: ({ proxyID, payload }: { proxyID: string; payload: ReturnType<typeof sshProxyFormToPayload> }) =>
      updateSSHProxy(proxyID, payload),
    onMutate: () => {
      setFormFeedback(null);
    },
    onSuccess: async (proxy) => {
      setForm(sshProxyToForm(proxy));
      setFormFeedback({ kind: "success", message: `SSH proxy updated: ${proxy.name}.` });
      await queryClient.invalidateQueries({ queryKey: connectivityRootKey });
    },
    onError: (error) => {
      setFormFeedback({ kind: "error", message: error instanceof Error ? error.message : "Failed to update proxy." });
    },
  });

  const removeProxy = useMutation({
    mutationFn: deleteSSHProxy,
    onMutate: () => {
      setDeleteFeedback(null);
    },
    onSuccess: async () => {
      startCreate();
      setDeleteFeedback({ kind: "success", message: "SSH proxy deleted." });
      await queryClient.invalidateQueries({ queryKey: connectivityRootKey });
    },
    onError: (error) => {
      setDeleteFeedback({ kind: "error", message: error instanceof Error ? error.message : "Failed to delete proxy." });
    },
  });

  const approveOverride = useMutation({
    mutationFn: (record: HostKeyRecord) => approveHostKeyOverride(record.scope, record.target_id),
    onMutate: () => {
      setHostKeyFeedback(null);
    },
    onSuccess: async (result) => {
      setHostKeyFeedback({
        kind: "success",
        message: `Host key override approved for ${result.ttl_minute || 10} minutes.`,
      });
      await queryClient.invalidateQueries({ queryKey: [...connectivityRootKey, "hostkeys"] });
    },
    onError: (error) => {
      setHostKeyFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to approve host key override.",
      });
    },
  });

  const forgetHostKey = useMutation({
    mutationFn: (record: HostKeyRecord) => deleteHostKey(record.scope, record.target_id),
    onMutate: () => {
      setHostKeyFeedback(null);
    },
    onSuccess: async () => {
      setHostKeyFeedback({ kind: "success", message: "Host key forgotten." });
      await queryClient.invalidateQueries({ queryKey: [...connectivityRootKey, "hostkeys"] });
    },
    onError: (error) => {
      setHostKeyFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to forget host key.",
      });
    },
  });

  function refreshConnectivity() {
    void proxies.refetch();
    void hostKeys.refetch();
  }

  function startCreate() {
    setFormMode("create");
    setSelectedProxyID("");
    setForm(emptySSHProxyForm);
    setValidationError("");
    setFormFeedback(null);
  }

  function editProxy(proxy: SSHProxy) {
    setFormMode("edit");
    setSelectedProxyID(proxy.id);
    setForm(sshProxyToForm(proxy));
    setValidationError("");
    setFormFeedback(null);
  }

  function submitProxy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateSSHProxyForm(form, formMode);
    setValidationError(error);
    if (error) return;

    const payload = sshProxyFormToPayload(form);
    if (formMode === "create") {
      createProxy.mutate(payload);
      return;
    }

    if (!selectedProxyID) {
      setValidationError("Select a proxy before updating.");
      return;
    }
    updateProxy.mutate({ proxyID: selectedProxyID, payload });
  }

  function deleteSelectedProxy(proxy: SSHProxy) {
    if (!window.confirm(`Delete SSH proxy ${proxy.name}? Assets using it will lose proxy routing.`)) return;
    removeProxy.mutate(proxy.id);
  }

  async function copyFingerprint(fingerprint: string) {
    try {
      await navigator.clipboard.writeText(fingerprint);
      setHostKeyFeedback({ kind: "success", message: "Fingerprint copied." });
    } catch (_error) {
      setHostKeyFeedback({ kind: "error", message: "Failed to copy fingerprint." });
    }
  }

  function approveHostKey(record: HostKeyRecord) {
    if (
      !window.confirm(
        `Approve one-time host key override for ${record.scope}/${record.target_id}? The next connection will replace the pinned fingerprint.`,
      )
    ) {
      return;
    }
    approveOverride.mutate(record);
  }

  function deleteHostKeyRecord(record: HostKeyRecord) {
    if (
      !window.confirm(
        `Forget pinned host key for ${record.scope}/${record.target_id}? The next connection will record a fresh fingerprint.`,
      )
    ) {
      return;
    }
    forgetHostKey.mutate(record);
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Network</p>
          <h1>Connectivity</h1>
        </div>
        <span className={`status-pill ${canReadAssets ? "ok" : "warn"}`}>
          <ShieldCheck size={14} aria-hidden="true" />
          {canReadAssets ? "cmdb.asset:read" : "Needs cmdb.asset:read"}
        </span>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-icon">
            <Route size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">SSH proxies</div>
            <div className="metric-value">{canReadAssets ? proxyItems.length : "-"}</div>
          </div>
          <span className="status-pill">configured</span>
        </article>

        <article className="metric-card">
          <div className="metric-icon">
            <Network size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Network zones</div>
            <div className="metric-value">{canReadAssets ? zoneCount : "-"}</div>
          </div>
          <span className="status-pill">mapped</span>
        </article>

        <article className="metric-card">
          <div className="metric-icon">
            <Fingerprint size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Host keys</div>
            <div className="metric-value">{canReadAssets ? hostKeyStats.pinned : "-"}</div>
          </div>
          <span className={`status-pill ${hostKeyStats.mismatched > 0 ? "warn" : "ok"}`}>
            {hostKeyStats.mismatched > 0 ? `${hostKeyStats.mismatched} mismatch` : "pinned"}
          </span>
        </article>

        <article className="metric-card">
          <div className="metric-icon">
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Key auth</div>
            <div className="metric-value">{canReadAssets ? keyAuthCount : "-"}</div>
          </div>
          <span className="status-pill">{hostKeyStats.pending} override pending</span>
        </article>
      </div>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Access</p>
            <h2>Connectivity permissions</h2>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={refreshConnectivity}
            disabled={!canReadAssets || proxies.isFetching || hostKeys.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{proxies.isFetching || hostKeys.isFetching ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
        <PermissionList permissions={connectivityPermissions} emptyLabel="No CMDB permissions." />
      </article>

      <div className="drawer-tabs" role="tablist" aria-label="Connectivity sections">
        <button
          type="button"
          className={`drawer-tab${activeTab === "proxies" ? " active" : ""}`}
          role="tab"
          aria-selected={activeTab === "proxies"}
          onClick={() => setActiveTab("proxies")}
        >
          SSH proxies
        </button>
        <button
          type="button"
          className={`drawer-tab${activeTab === "hostkeys" ? " active" : ""}`}
          role="tab"
          aria-selected={activeTab === "hostkeys"}
          onClick={() => setActiveTab("hostkeys")}
        >
          Host keys
        </button>
      </div>

      {activeTab === "proxies" ? (
        <div className="profile-grid">
        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">SSH proxies</p>
              <h2>Jump hosts</h2>
            </div>
            <button type="button" className="primary-button compact" onClick={startCreate} disabled={!canWriteAssets}>
              <Plus size={14} aria-hidden="true" />
              <span>New proxy</span>
            </button>
          </div>

          {!canReadAssets ? <PanelState kind="permission" message="Permission required: cmdb.asset:read" /> : null}
          {!canWriteAssets ? <PanelState kind="permission" message="Permission required: cmdb.asset:write" /> : null}
          {deleteFeedback ? <PanelState kind={deleteFeedback.kind} message={deleteFeedback.message} /> : null}

          {canReadAssets && proxies.isError ? (
            <PanelState
              kind="error"
              message={proxies.error instanceof Error ? proxies.error.message : "Failed to load SSH proxies."}
            />
          ) : null}

          {canReadAssets && proxies.isLoading ? <PanelState kind="loading" message="Loading SSH proxies" /> : null}

          {canReadAssets && !proxies.isLoading && !proxies.isError && proxyItems.length === 0 ? (
            <PanelState kind="empty" message="No SSH proxies yet." />
          ) : null}

          {proxyItems.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table compact-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Zone</th>
                    <th>Endpoint</th>
                    <th>Username</th>
                    <th>Auth</th>
                    <th>Credentials</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {proxyItems.map((proxy) => (
                    <tr className={selectedProxyID === proxy.id ? "selected" : ""} key={proxy.id}>
                      <td>
                        <strong>{proxy.name}</strong>
                        {proxy.description ? <div className="muted">{proxy.description}</div> : null}
                      </td>
                      <td>{proxy.network_zone || "-"}</td>
                      <td>
                        <code>{proxyEndpoint(proxy)}</code>
                      </td>
                      <td>{proxy.username || "-"}</td>
                      <td>
                        <span className="status-pill">{proxy.auth_type}</span>
                      </td>
                      <td>{credentialChips(proxy)}</td>
                      <td>
                        <div className="request-actions">
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => editProxy(proxy)}
                            disabled={!canWriteAssets}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => deleteSelectedProxy(proxy)}
                            disabled={!canWriteAssets || removeProxy.isPending}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">{formMode === "create" ? "Create" : "Update"}</p>
              <h2>{formMode === "create" ? "New SSH proxy" : selectedProxy?.name || "Edit SSH proxy"}</h2>
            </div>
            <span className={`status-pill ${canWriteAssets ? "ok" : "warn"}`}>
              {canWriteAssets ? "cmdb.asset:write" : "write required"}
            </span>
          </div>

          {validationError ? <PanelState kind="error" message={validationError} /> : null}
          {formFeedback ? <PanelState kind={formFeedback.kind} message={formFeedback.message} /> : null}

          <form className="request-form" onSubmit={submitProxy}>
            <div className="form-grid">
              <label className="form-field">
                <span>Name</span>
                <input
                  value={form.name}
                  onChange={(event) => updateForm(setForm, "name", event.target.value)}
                  disabled={!canWriteAssets}
                />
              </label>

              <label className="form-field">
                <span>Network zone</span>
                <input
                  value={form.networkZone}
                  onChange={(event) => updateForm(setForm, "networkZone", event.target.value)}
                  placeholder="zone-a"
                  disabled={!canWriteAssets}
                />
              </label>

              <label className="form-field">
                <span>Host</span>
                <input
                  value={form.host}
                  onChange={(event) => updateForm(setForm, "host", event.target.value)}
                  disabled={!canWriteAssets}
                />
              </label>

              <label className="form-field">
                <span>Port</span>
                <input
                  type="number"
                  min={1}
                  value={form.port}
                  onChange={(event) => updateForm(setForm, "port", event.target.value)}
                  disabled={!canWriteAssets}
                />
              </label>

              <label className="form-field">
                <span>Username</span>
                <input
                  value={form.username}
                  onChange={(event) => updateForm(setForm, "username", event.target.value)}
                  disabled={!canWriteAssets}
                />
              </label>

              <label className="form-field">
                <span>Auth type</span>
                <select
                  value={form.authType}
                  onChange={(event) => updateForm(setForm, "authType", event.target.value as SSHProxy["auth_type"])}
                  disabled={!canWriteAssets}
                >
                  <option value="password">password</option>
                  <option value="key">key</option>
                </select>
              </label>

              <label className="form-field full-field">
                <span>Description</span>
                <input
                  value={form.description}
                  onChange={(event) => updateForm(setForm, "description", event.target.value)}
                  disabled={!canWriteAssets}
                />
              </label>

              {form.authType === "password" ? (
                <label className="form-field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) => updateForm(setForm, "password", event.target.value)}
                    placeholder={form.hasPassword ? "Leave empty to keep saved value" : "enter password"}
                    disabled={!canWriteAssets}
                  />
                </label>
              ) : (
                <>
                  <label className="form-field full-field">
                    <span>Private key</span>
                    <textarea
                      value={form.privateKey}
                      onChange={(event) => updateForm(setForm, "privateKey", event.target.value)}
                      placeholder={form.hasPrivateKey ? "Leave empty to keep saved value" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                      rows={5}
                      disabled={!canWriteAssets}
                    />
                  </label>
                  <label className="form-field">
                    <span>Passphrase</span>
                    <input
                      type="password"
                      value={form.passphrase}
                      onChange={(event) => updateForm(setForm, "passphrase", event.target.value)}
                      placeholder={form.hasPassphrase ? "Leave empty to keep saved value" : "optional"}
                      disabled={!canWriteAssets}
                    />
                  </label>
                </>
              )}
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={!canWriteAssets || createProxy.isPending || updateProxy.isPending}
              >
                <Save size={16} aria-hidden="true" />
                <span>
                  {createProxy.isPending || updateProxy.isPending
                    ? "Saving"
                    : formMode === "create"
                    ? "Create proxy"
                    : "Save changes"}
                </span>
              </button>
              {formMode === "edit" ? (
                <button type="button" className="secondary-button" onClick={startCreate}>
                  New proxy
                </button>
              ) : null}
            </div>
          </form>
        </article>
      </div>
      ) : null}

      {activeTab === "hostkeys" ? (
        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Host keys</p>
              <h2>Pinned fingerprints</h2>
            </div>
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => void hostKeys.refetch()}
              disabled={!canReadAssets || hostKeys.isFetching}
            >
              <RefreshCw size={14} aria-hidden="true" />
              <span>{hostKeys.isFetching ? "Refreshing" : "Refresh"}</span>
            </button>
          </div>

          {!canReadAssets ? <PanelState kind="permission" message="Permission required: cmdb.asset:read" /> : null}
          {!canWriteAssets ? <PanelState kind="permission" message="Permission required: cmdb.asset:write" /> : null}
          {hostKeyFeedback ? <PanelState kind={hostKeyFeedback.kind} message={hostKeyFeedback.message} /> : null}

          {canReadAssets && hostKeys.isError ? (
            <PanelState
              kind="error"
              message={hostKeys.error instanceof Error ? hostKeys.error.message : "Failed to load host keys."}
            />
          ) : null}

          <div className="filter-panel">
            <label className="form-field search-field">
              <span>Search</span>
              <div className="input-with-icon">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={hostKeyQuery}
                  onChange={(event) => setHostKeyQuery(event.target.value)}
                  placeholder="Target, host, fingerprint"
                  disabled={!canReadAssets}
                />
              </div>
            </label>

            <div className="drawer-tabs" role="tablist" aria-label="Host key scope">
              {[
                { label: "All", value: "all" },
                { label: "Assets", value: "asset" },
                { label: "Proxies", value: "proxy" },
              ].map((item) => (
                <button
                  type="button"
                  className={`drawer-tab${hostKeyScope === item.value ? " active" : ""}`}
                  key={item.value}
                  onClick={() => setHostKeyScope(item.value as "all" | HostKeyScope)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {canReadAssets && hostKeys.isLoading ? <PanelState kind="loading" message="Loading host keys" /> : null}

          {canReadAssets && !hostKeys.isLoading && !hostKeys.isError && filteredHostKeys.length === 0 ? (
            <PanelState kind="empty" message="No matching host keys." />
          ) : null}

          {filteredHostKeys.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Scope</th>
                    <th>Target</th>
                    <th>Host</th>
                    <th>Fingerprint</th>
                    <th>Status</th>
                    <th>Last seen</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHostKeys.map((record) => {
                    const isOverridePending = record.status === "override_pending";
                    return (
                      <tr key={`${record.scope}:${record.target_id}`}>
                        <td>
                          <span className="status-pill">{record.scope}</span>
                        </td>
                        <td>
                          <strong>{hostKeyTargetLabel(record)}</strong>
                          <div className="muted">{record.target_id}</div>
                        </td>
                        <td>
                          <code>{hostKeyEndpoint(record)}</code>
                        </td>
                        <td>
                          <div className="fingerprint-cell">
                            <code>{record.fingerprint_sha256}</code>
                            <button
                              type="button"
                              className="icon-button compact-icon"
                              onClick={() => void copyFingerprint(record.fingerprint_sha256)}
                              title="Copy fingerprint"
                            >
                              <Copy size={14} aria-hidden="true" />
                            </button>
                          </div>
                          <div className="muted">{record.key_type || "-"}</div>
                          {record.last_mismatch_at && record.status === "active" ? (
                            <div className="muted inline-error">
                              offered <code>{record.last_mismatch_fingerprint || "-"}</code>
                            </div>
                          ) : null}
                          {isOverridePending ? (
                            <div className="muted">
                              by {record.override_by || "admin"} until {formatDateTime(record.override_expires_at)}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <span className={`status-pill ${hostKeyStatusTone(record)}`}>
                            {isOverridePending
                              ? "override pending"
                              : record.last_mismatch_at && record.status === "active"
                              ? "mismatch"
                              : record.status}
                          </span>
                        </td>
                        <td>{formatDateTime(record.last_seen_at)}</td>
                        <td>
                          <div className="request-actions">
                            {!isOverridePending ? (
                              <button
                                type="button"
                                className="secondary-button compact"
                                onClick={() => approveHostKey(record)}
                                disabled={!canWriteAssets || approveOverride.isPending}
                              >
                                Approve
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="secondary-button compact"
                              onClick={() => deleteHostKeyRecord(record)}
                              disabled={!canWriteAssets || forgetHostKey.isPending}
                            >
                              Forget
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
