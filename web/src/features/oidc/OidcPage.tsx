import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, PlugZap, RefreshCw, Save, Settings2, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { getOIDCSettings, testOIDCSettings, updateOIDCSettings, type OIDCConnectionTestResult } from "../../api/oidc";
import { PanelState } from "../../components/PanelState";
import { PermissionList } from "../../components/PermissionList";
import { oidcFormToPayload, oidcSettingsToForm, validateOIDCForm, type OIDCSettingsFormState } from "../../lib/oidc";
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

function updateForm<K extends keyof OIDCSettingsFormState>(
  setForm: (updater: (current: OIDCSettingsFormState) => OIDCSettingsFormState) => void,
  key: K,
  value: OIDCSettingsFormState[K],
) {
  setForm((current) => ({ ...current, [key]: value }));
}

function testSummary(result: OIDCConnectionTestResult | undefined) {
  if (!result) return "";
  return `${result.http_status || result.status} at ${formatDateTime(result.checked_at)}`;
}

export function OidcPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const userID = auth.identity?.user.id || "";
  const canReadIAM = auth.can("iam.user:read");
  const canWriteIAM = auth.can("iam.user:write");
  const oidcPermissions = (auth.identity?.permissions || []).filter((permission) => permission.startsWith("iam.user:"));
  const [form, setForm] = useState<OIDCSettingsFormState>(() => oidcSettingsToForm(undefined));
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [validationError, setValidationError] = useState("");
  const queryKey = ["oidc", userID, "settings"] as const;

  const settings = useQuery({
    queryKey,
    queryFn: getOIDCSettings,
    enabled: canReadIAM && Boolean(userID),
  });

  useEffect(() => {
    if (!settings.data) return;
    setForm(oidcSettingsToForm(settings.data));
    setValidationError("");
  }, [settings.data]);

  const saveSettings = useMutation({
    mutationFn: updateOIDCSettings,
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: async (saved) => {
      setForm(oidcSettingsToForm(saved));
      setFeedback({ kind: "success", message: "OIDC configuration saved." });
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to save OIDC configuration.",
      });
    },
  });

  const testConnection = useMutation({
    mutationFn: testOIDCSettings,
    onMutate: () => {
      setFeedback(null);
    },
    onSuccess: (result) => {
      setFeedback({ kind: "success", message: `OIDC connection OK: ${result.http_status || result.status}.` });
    },
    onError: (error) => {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "OIDC connection test failed." });
    },
  });

  function formPayload() {
    const error = validateOIDCForm(form);
    setValidationError(error);
    if (error) return null;

    return oidcFormToPayload(form);
  }

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = formPayload();
    if (!payload) return;

    saveSettings.mutate(payload);
  }

  function runConnectionTest() {
    const payload = formPayload();
    if (!payload) return;

    testConnection.mutate(payload);
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div>
          <p className="eyebrow">Runtime settings</p>
          <h1>OIDC</h1>
        </div>
        <span className={`status-pill ${settings.data?.enabled ? "ok" : "warn"}`}>
          <ShieldCheck size={14} aria-hidden="true" />
          {settings.data?.enabled ? "enabled" : "disabled"}
        </span>
      </div>

      <div className="metric-grid">
        <article className="metric-card">
          <div className="metric-icon">
            <Settings2 size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Provider</div>
            <div className="metric-value compact">{settings.data?.issuer_url || form.issuerURL || "-"}</div>
          </div>
          <span className={`status-pill ${settings.data?.enabled ? "ok" : "warn"}`}>
            {settings.data?.enabled ? "active" : "off"}
          </span>
        </article>

        <article className="metric-card">
          <div className="metric-icon">
            <KeyRound size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Client secret</div>
            <div className="metric-value compact">{settings.data?.has_client_secret ? "saved" : "missing"}</div>
          </div>
          <span className={`status-pill ${settings.data?.has_client_secret ? "ok" : "info"}`}>
            {settings.data?.has_client_secret ? "stored" : "empty"}
          </span>
        </article>

        <article className="metric-card">
          <div className="metric-icon">
            <PlugZap size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="metric-label">Last test</div>
            <div className="metric-value compact">{testSummary(testConnection.data) || "-"}</div>
          </div>
          <span className={`status-pill ${testConnection.data ? "ok" : "info"}`}>
            {testConnection.data?.status || "idle"}
          </span>
        </article>
      </div>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Access</p>
            <h2>IAM permissions</h2>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => void settings.refetch()}
            disabled={!canReadIAM || settings.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{settings.isFetching ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
        <PermissionList permissions={oidcPermissions} emptyLabel="No IAM permissions." />
      </article>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Configuration</p>
            <h2>Provider settings</h2>
          </div>
          <span className="status-pill">Updated {formatDateTime(settings.data?.updated_at)}</span>
        </div>

        {!canReadIAM ? <PanelState kind="permission" message="Permission required: iam.user:read" /> : null}

        {canReadIAM && !canWriteIAM ? (
          <PanelState kind="permission" message="Permission required: iam.user:write" />
        ) : null}

        {settings.isLoading ? <PanelState kind="loading" message="Loading OIDC configuration" /> : null}

        {settings.isError ? (
          <PanelState
            kind="error"
            message={settings.error instanceof Error ? settings.error.message : "Failed to load OIDC configuration."}
          />
        ) : null}

        {validationError ? <PanelState kind="error" message={validationError} /> : null}
        {feedback ? <PanelState kind={feedback.kind} message={feedback.message} /> : null}

        <form className="request-form" onSubmit={submitSettings}>
          <label className="toggle-row form-toggle-row oidc-enabled-row">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => updateForm(setForm, "enabled", event.target.checked)}
              disabled={!canWriteIAM || saveSettings.isPending || testConnection.isPending}
            />
            <span>Enable OIDC login</span>
          </label>

          <div className="form-grid">
            <label className="form-field">
              <span>Issuer URL</span>
              <input
                value={form.issuerURL}
                onChange={(event) => updateForm(setForm, "issuerURL", event.target.value)}
                placeholder="https://auth.example.com"
                disabled={!canWriteIAM}
              />
            </label>

            <label className="form-field">
              <span>Client ID</span>
              <input
                value={form.clientID}
                onChange={(event) => updateForm(setForm, "clientID", event.target.value)}
                disabled={!canWriteIAM}
              />
            </label>

            <label className="form-field">
              <span>Client secret</span>
              <input
                type="password"
                value={form.clientSecret}
                onChange={(event) => updateForm(setForm, "clientSecret", event.target.value)}
                placeholder={settings.data?.has_client_secret ? "Saved, leave empty to keep" : ""}
                disabled={!canWriteIAM}
              />
            </label>

            <label className="form-field">
              <span>Redirect URL</span>
              <input
                value={form.redirectURL}
                onChange={(event) => updateForm(setForm, "redirectURL", event.target.value)}
                placeholder="http://localhost:8080/auth/oidc/callback"
                disabled={!canWriteIAM}
              />
            </label>

            <label className="form-field">
              <span>Authorize URL</span>
              <input
                value={form.authorizeURL}
                onChange={(event) => updateForm(setForm, "authorizeURL", event.target.value)}
                disabled={!canWriteIAM}
              />
            </label>

            <label className="form-field">
              <span>Token URL</span>
              <input
                value={form.tokenURL}
                onChange={(event) => updateForm(setForm, "tokenURL", event.target.value)}
                disabled={!canWriteIAM}
              />
            </label>

            <label className="form-field">
              <span>Userinfo URL</span>
              <input
                value={form.userInfoURL}
                onChange={(event) => updateForm(setForm, "userInfoURL", event.target.value)}
                disabled={!canWriteIAM}
              />
            </label>

            <label className="form-field">
              <span>Scopes</span>
              <input
                value={form.scopes}
                onChange={(event) => updateForm(setForm, "scopes", event.target.value)}
                placeholder="openid, profile, email"
                disabled={!canWriteIAM}
              />
            </label>
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={runConnectionTest}
              disabled={!canWriteIAM || testConnection.isPending || saveSettings.isPending}
            >
              <PlugZap size={16} aria-hidden="true" />
              <span>{testConnection.isPending ? "Testing" : "Test connection"}</span>
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={!canWriteIAM || saveSettings.isPending || testConnection.isPending}
            >
              <Save size={16} aria-hidden="true" />
              <span>{saveSettings.isPending ? "Saving" : "Save configuration"}</span>
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
