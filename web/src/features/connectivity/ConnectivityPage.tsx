import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Plus, RefreshCw, Route, Save, ShieldCheck, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import {
  createSSHProxy,
  deleteSSHProxy,
  listSSHProxies,
  updateSSHProxy,
  type SSHProxy,
} from "../../api/connectivity";
import { PanelState } from "../../components/PanelState";
import { PermissionList } from "../../components/PermissionList";
import {
  emptySSHProxyForm,
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

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function proxyEndpoint(proxy: SSHProxy) {
  return `${proxy.host}:${proxy.port || 22}`;
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
  const [selectedProxyID, setSelectedProxyID] = useState("");
  const [validationError, setValidationError] = useState("");
  const [formFeedback, setFormFeedback] = useState<ActionFeedback | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<ActionFeedback | null>(null);

  const proxies = useQuery({
    queryKey: [...connectivityRootKey, "ssh-proxies"],
    queryFn: listSSHProxies,
    enabled: canReadAssets && Boolean(userID),
  });
  const proxyItems = proxies.data?.items || [];
  const selectedProxy = proxyItems.find((proxy) => proxy.id === selectedProxyID);
  const zoneCount = new Set(proxyItems.map((proxy) => proxy.network_zone).filter(Boolean)).size;
  const keyAuthCount = proxyItems.filter((proxy) => proxy.auth_type === "key").length;

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
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Key auth</div>
            <div className="metric-value">{canReadAssets ? keyAuthCount : "-"}</div>
          </div>
          <span className="status-pill">proxies</span>
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
            onClick={() => void proxies.refetch()}
            disabled={!canReadAssets || proxies.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{proxies.isFetching ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
        <PermissionList permissions={connectivityPermissions} emptyLabel="No CMDB permissions." />
      </article>

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
    </section>
  );
}
