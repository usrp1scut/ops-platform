import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, CloudCog, Plus, RefreshCw, Save, ShieldCheck, X, Zap } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createAwsAccount,
  getAwsSyncStatus,
  listAwsAccounts,
  listAwsSyncRuns,
  testAwsAccount,
  triggerAwsSync,
  updateAwsAccount,
  type AwsAccount,
  type AwsConnectionTestResult,
  type AwsSyncRun,
  type AwsSyncRunStatus,
  type AwsSyncStatus,
} from "../../api/aws";
import { PanelState } from "../../components/PanelState";
import { PermissionList } from "../../components/PermissionList";
import { useModalFocus } from "../../hooks/useModalFocus";
import {
  awsAccountToForm,
  awsFormToCreatePayload,
  awsFormToUpdatePayload,
  emptyAwsAccountForm,
  summarizeAwsSyncByAccount,
  validateAwsAccountForm,
  type AwsAccountFormMode,
  type AwsAccountFormState,
} from "../../lib/aws";
import { useAuth } from "../auth/AuthProvider";

type ActionFeedback = {
  kind: "error" | "success";
  message: string;
};

type TestFeedback = ActionFeedback & {
  result?: AwsConnectionTestResult;
};

const syncStatusOptions: Array<{ label: string; value: "" | AwsSyncRunStatus }> = [
  { label: "All", value: "" },
  { label: "Running", value: "running" },
  { label: "Success", value: "success" },
  { label: "Failed", value: "failed" },
];

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatRelative(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "just now";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function statusTone(status: string | undefined) {
  if (status === "success" || status === "ok") return "ok";
  if (status === "failed") return "warn";
  if (status === "running") return "info";
  return "";
}

function syncStatusLabel(status: AwsSyncStatus | undefined) {
  if (!status) return "not run";
  if (status.running) return "running";
  if (status.last_error) return "failed";
  return "idle";
}

function accountCredentialLabel(account: AwsAccount) {
  if (account.auth_mode === "assume_role") return account.role_arn || "-";
  return account.access_key_id || "-";
}

function syncRunStatusPill(run: AwsSyncRun | undefined) {
  if (!run) return <span className="muted">never</span>;

  return (
    <span className={`status-pill ${statusTone(run.status)}`}>
      {run.status === "success" ? "ok" : run.status}
    </span>
  );
}

function updateForm<K extends keyof AwsAccountFormState>(
  setForm: (updater: (current: AwsAccountFormState) => AwsAccountFormState) => void,
  key: K,
  value: AwsAccountFormState[K],
) {
  setForm((current) => ({ ...current, [key]: value }));
}

function regionChips(regions: string[]) {
  if (regions.length === 0) return <span className="muted">none</span>;

  return (
    <div className="chip-list">
      {regions.map((region) => (
        <span className="chip" key={region}>
          {region}
        </span>
      ))}
    </div>
  );
}

export function AwsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const userID = auth.identity?.user.id || "";
  const canReadAws = auth.can("aws.account:read");
  const canWriteAws = auth.can("aws.account:write");
  const awsPermissions = (auth.identity?.permissions || []).filter((permission) => permission.startsWith("aws.account:"));
  const awsRootKey = ["aws", userID] as const;
  const [formMode, setFormMode] = useState<AwsAccountFormMode>("create");
  const [form, setForm] = useState<AwsAccountFormState>(emptyAwsAccountForm);
  const [selectedAccountID, setSelectedAccountID] = useState("");
  const [validationError, setValidationError] = useState("");
  const [formFeedback, setFormFeedback] = useState<ActionFeedback | null>(null);
  const [testFeedback, setTestFeedback] = useState<TestFeedback | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<ActionFeedback | null>(null);
  const [syncRunStatus, setSyncRunStatus] = useState<"" | AwsSyncRunStatus>("");
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  useEffect(() => {
    document.body.classList.add("fullwidth-mode");
    return () => {
      document.body.classList.remove("fullwidth-mode");
    };
  }, []);

  const accounts = useQuery({
    queryKey: [...awsRootKey, "accounts"],
    queryFn: listAwsAccounts,
    enabled: canReadAws && Boolean(userID),
  });
  const syncStatus = useQuery({
    queryKey: [...awsRootKey, "sync", "status"],
    queryFn: getAwsSyncStatus,
    enabled: canReadAws && Boolean(userID),
  });
  const syncRuns = useQuery({
    queryKey: [...awsRootKey, "sync", "runs", 120],
    queryFn: () => listAwsSyncRuns({ limit: 120 }),
    enabled: canReadAws && Boolean(userID),
  });

  const accountItems = accounts.data?.items || [];
  const runItems = syncRuns.data?.items || [];
  const selectedAccount = accountItems.find((account) => account.id === selectedAccountID);
  const syncSummary = useMemo(() => summarizeAwsSyncByAccount(runItems), [runItems]);
  const filteredRuns = useMemo(
    () => runItems.filter((run) => !syncRunStatus || run.status === syncRunStatus),
    [runItems, syncRunStatus],
  );

  const createAccount = useMutation({
    mutationFn: createAwsAccount,
    onMutate: () => {
      setFormFeedback(null);
    },
    onSuccess: async (account) => {
      setForm(emptyAwsAccountForm);
      setSelectedAccountID(account.id);
      setFormMode("edit");
      setAccountModalOpen(false);
      setFormFeedback({ kind: "success", message: `AWS account added: ${account.account_id}.` });
      await queryClient.invalidateQueries({ queryKey: awsRootKey });
    },
    onError: (error) => {
      setFormFeedback({ kind: "error", message: error instanceof Error ? error.message : "Failed to add account." });
    },
  });

  const updateAccount = useMutation({
    mutationFn: ({ accountID, payload }: { accountID: string; payload: ReturnType<typeof awsFormToUpdatePayload> }) =>
      updateAwsAccount(accountID, payload),
    onMutate: () => {
      setFormFeedback(null);
    },
    onSuccess: async (account) => {
      setForm(awsAccountToForm(account));
      setFormFeedback({ kind: "success", message: `AWS account updated: ${account.account_id}.` });
      await queryClient.invalidateQueries({ queryKey: awsRootKey });
    },
    onError: (error) => {
      setFormFeedback({ kind: "error", message: error instanceof Error ? error.message : "Failed to update account." });
    },
  });

  const testAccount = useMutation({
    mutationFn: testAwsAccount,
    onMutate: () => {
      setTestFeedback(null);
    },
    onSuccess: (result) => {
      setTestFeedback({
        kind: "success",
        message: `AWS connection OK: ${result.arn || result.account_id || result.region}.`,
        result,
      });
    },
    onError: (error) => {
      setTestFeedback({ kind: "error", message: error instanceof Error ? error.message : "AWS connection test failed." });
    },
  });

  const runSync = useMutation({
    mutationFn: triggerAwsSync,
    onMutate: () => {
      setSyncFeedback(null);
    },
    onSuccess: async (result) => {
      setSyncFeedback({ kind: "success", message: result.message });
      await queryClient.invalidateQueries({ queryKey: [...awsRootKey, "sync"] });
    },
    onError: (error) => {
      setSyncFeedback({ kind: "error", message: error instanceof Error ? error.message : "Failed to trigger sync." });
    },
  });

  function refreshAws() {
    void accounts.refetch();
    void syncStatus.refetch();
    void syncRuns.refetch();
  }

  function startCreate() {
    setFormMode("create");
    setSelectedAccountID("");
    setForm(emptyAwsAccountForm);
    setValidationError("");
    setFormFeedback(null);
    setTestFeedback(null);
    setAccountModalOpen(true);
  }

  function editAccount(account: AwsAccount) {
    setFormMode("edit");
    setSelectedAccountID(account.id);
    setForm(awsAccountToForm(account));
    setValidationError("");
    setFormFeedback(null);
    setTestFeedback(null);
    setAccountModalOpen(true);
  }

  function closeAccountModal() {
    setAccountModalOpen(false);
    setFormFeedback(null);
    setValidationError("");
    setTestFeedback(null);
  }

  const { panelRef: accountModalRef, closeButtonRef: accountModalCloseRef } = useModalFocus(
    accountModalOpen,
    closeAccountModal,
  );

  // Edit mode mutates only the in-memory form until Save; the Test
  // connection endpoint reads the persisted account by ID, so testing
  // a dirty form would silently exercise the stale config. Track dirty
  // state so we can warn the user and re-label the button.
  const isFormDirty =
    formMode === "edit" && selectedAccount
      ? JSON.stringify(form) !== JSON.stringify(awsAccountToForm(selectedAccount))
      : false;

  function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validateAwsAccountForm(form, formMode);
    setValidationError(error);
    if (error) return;

    if (formMode === "create") {
      createAccount.mutate(awsFormToCreatePayload(form));
      return;
    }

    if (!selectedAccountID) {
      setValidationError("Select an account before updating.");
      return;
    }
    updateAccount.mutate({ accountID: selectedAccountID, payload: awsFormToUpdatePayload(form) });
  }

  function testSelectedOrAccount(accountID: string) {
    if (!accountID) return;
    testAccount.mutate(accountID);
  }

  const refreshing = accounts.isFetching || syncStatus.isFetching || syncRuns.isFetching;
  const syncRunning = Boolean(syncStatus.data?.running);
  const syncTone = syncRunning ? "info" : syncStatus.data?.last_error ? "warn" : "ok";

  return (
    <section className="page-section aws-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Cloud accounts</p>
          <h1>AWS</h1>
        </div>
        <span className={`status-pill ${canReadAws ? "ok" : "warn"}`}>
          <ShieldCheck size={14} aria-hidden="true" />
          {canReadAws ? "aws.account:read" : "Needs aws.account:read"}
        </span>
      </div>

      <div className="aws-toolbar">
        <div className="aws-toolbar-stats">
          <span className="aws-stat">
            <Cloud size={14} aria-hidden="true" />
            <strong>{canReadAws ? accountItems.length : "-"}</strong>
            <span className="muted">accounts</span>
          </span>
          <span className="aws-stat">
            <CloudCog size={14} aria-hidden="true" />
            <span className={`status-pill ${syncTone}`}>{syncStatusLabel(syncStatus.data)}</span>
            <span className="muted">sync</span>
          </span>
          <span className="aws-stat">
            <Zap size={14} aria-hidden="true" />
            <strong>{canReadAws ? runItems.length : "-"}</strong>
            <span className="muted">runs (last 120)</span>
          </span>
        </div>
        <div className="aws-toolbar-actions">
          <button
            type="button"
            className="secondary-button compact"
            onClick={refreshAws}
            disabled={!canReadAws || refreshing}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{refreshing ? "Refreshing" : "Refresh"}</span>
          </button>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => runSync.mutate()}
            disabled={!canWriteAws || runSync.isPending || syncRunning}
          >
            <Zap size={14} aria-hidden="true" />
            <span>{runSync.isPending ? "Triggering" : syncRunning ? "Running" : "Run sync"}</span>
          </button>
          <button type="button" className="primary-button compact" onClick={startCreate} disabled={!canWriteAws}>
            <Plus size={14} aria-hidden="true" />
            <span>Add account</span>
          </button>
        </div>
      </div>

      {!accountModalOpen && formFeedback ? (
        <PanelState kind={formFeedback.kind} message={formFeedback.message} />
      ) : null}
      {syncFeedback ? <PanelState kind={syncFeedback.kind} message={syncFeedback.message} /> : null}
      {testFeedback && !accountModalOpen ? <PanelState kind={testFeedback.kind} message={testFeedback.message} /> : null}

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Accounts</p>
            <h2>Connected accounts</h2>
          </div>
          <span className={`status-pill ${canWriteAws ? "ok" : "warn"}`}>
            {canWriteAws ? "aws.account:write" : "read-only"}
          </span>
        </div>

        {!canReadAws ? <PanelState kind="permission" message="Permission required: aws.account:read" /> : null}

        {canReadAws && accounts.isError ? (
          <PanelState
            kind="error"
            message={accounts.error instanceof Error ? accounts.error.message : "Failed to load AWS accounts."}
          />
        ) : null}

        {canReadAws && accounts.isLoading ? <PanelState kind="loading" message="Loading AWS accounts" /> : null}

        {canReadAws && !accounts.isLoading && !accounts.isError && accountItems.length === 0 ? (
          <PanelState kind="empty" message="No AWS accounts connected yet." />
        ) : null}

        {accountItems.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table aws-accounts-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Auth</th>
                  <th>Credential</th>
                  <th>Regions</th>
                  <th>Last sync</th>
                  <th>Status</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accountItems.map((account) => {
                  const summary = syncSummary[account.account_id];
                  return (
                    <tr className={selectedAccountID === account.id ? "selected" : ""} key={account.id}>
                      <td>
                        <strong>{account.display_name}</strong>
                        <div className="muted">{account.account_id}</div>
                      </td>
                      <td>{account.auth_mode}</td>
                      <td>
                        <code>{accountCredentialLabel(account)}</code>
                      </td>
                      <td>{regionChips(account.region_allowlist || [])}</td>
                      <td>
                        <div className="last-sync-cell">
                          {syncRunStatusPill(summary?.lastRun)}
                          {summary?.lastRun ? <span className="muted">{formatRelative(summary.lastRun.started_at)}</span> : null}
                        </div>
                        {summary?.lastRun?.status === "failed" && summary.lastRun.error_message ? (
                          <div className="muted inline-error">{summary.lastRun.error_message}</div>
                        ) : null}
                        {summary?.lastSuccess && summary.lastRun?.status === "failed" ? (
                          <div className="muted">last ok {formatRelative(summary.lastSuccess.started_at)}</div>
                        ) : null}
                      </td>
                      <td>
                        <span className={`status-pill ${account.enabled ? "ok" : "warn"}`}>
                          {account.enabled ? "enabled" : "disabled"}
                        </span>
                      </td>
                      <td className="col-actions">
                        <div className="request-actions">
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => editAccount(account)}
                            disabled={!canWriteAws}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => testSelectedOrAccount(account.id)}
                            disabled={!canWriteAws || testAccount.isPending}
                          >
                            Test
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

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Sync</p>
            <h2>Sync status</h2>
          </div>
          <span className={`status-pill ${syncTone}`}>{syncRunning ? "running" : "ready"}</span>
        </div>

        <dl className="detail-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`status-pill ${syncTone}`}>{syncStatusLabel(syncStatus.data)}</span>
            </dd>
          </div>
          <div>
            <dt>Last started</dt>
            <dd>{formatDateTime(syncStatus.data?.last_started_at)}</dd>
          </div>
          <div>
            <dt>Last finished</dt>
            <dd>{formatDateTime(syncStatus.data?.last_finished_at)}</dd>
          </div>
          <div>
            <dt>Last error</dt>
            <dd>{syncStatus.data?.last_error || "-"}</dd>
          </div>
        </dl>
      </article>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">History</p>
            <h2>Sync runs</h2>
          </div>
          <label className="form-field table-filter-field">
            <span>Status</span>
            <select value={syncRunStatus} onChange={(event) => setSyncRunStatus(event.target.value as "" | AwsSyncRunStatus)}>
              {syncStatusOptions.map((option) => (
                <option value={option.value} key={option.value || "all"}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!canReadAws ? <PanelState kind="permission" message="Permission required: aws.account:read" /> : null}

        {canReadAws && syncRuns.isError ? (
          <PanelState
            kind="error"
            message={syncRuns.error instanceof Error ? syncRuns.error.message : "Failed to load sync runs."}
          />
        ) : null}

        {canReadAws && syncRuns.isLoading ? <PanelState kind="loading" message="Loading sync runs" /> : null}

        {canReadAws && !syncRuns.isLoading && !syncRuns.isError && filteredRuns.length === 0 ? (
          <PanelState kind="empty" message={syncRunStatus ? `No ${syncRunStatus} runs.` : "No sync runs yet."} />
        ) : null}

        {filteredRuns.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Account</th>
                  <th>Region</th>
                  <th>Resource</th>
                  <th>Status</th>
                  <th>Processed</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{formatDateTime(run.started_at)}</td>
                    <td>
                      <strong>{run.account_display_name || "-"}</strong>
                      <div className="muted">{run.account_id}</div>
                    </td>
                    <td>
                      <code>{run.region || "-"}</code>
                    </td>
                    <td>
                      {run.resource_type || "-"}
                      {run.status === "failed" && run.error_message ? (
                        <div className="muted inline-error">{run.error_message}</div>
                      ) : null}
                    </td>
                    <td>
                      <span className={`status-pill ${statusTone(run.status)}`}>{run.status}</span>
                    </td>
                    <td>{run.resources_processed || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      <article className="work-panel aws-permissions-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Access</p>
            <h2>AWS permissions</h2>
          </div>
        </div>
        <PermissionList permissions={awsPermissions} emptyLabel="No AWS permissions." />
      </article>

      {accountModalOpen ? (
        <div className="aws-modal" role="dialog" aria-modal="true" aria-label="AWS account form">
          <button
            type="button"
            className="aws-modal-backdrop"
            aria-label="Close"
            onClick={closeAccountModal}
          />
          <div className="aws-modal-card" ref={accountModalRef} tabIndex={-1}>
            <div className="aws-modal-head">
              <div>
                <p className="eyebrow">{formMode === "create" ? "Connect" : "Update"}</p>
                <h2>{formMode === "create" ? "Add AWS account" : selectedAccount?.display_name || "Edit AWS account"}</h2>
              </div>
              <button
                ref={accountModalCloseRef}
                type="button"
                className="icon-button"
                onClick={closeAccountModal}
                aria-label="Close"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {!canWriteAws ? <PanelState kind="permission" message="Permission required: aws.account:write" /> : null}
            {validationError ? <PanelState kind="error" message={validationError} /> : null}
            {formFeedback ? <PanelState kind={formFeedback.kind} message={formFeedback.message} /> : null}
            {testFeedback ? <PanelState kind={testFeedback.kind} message={testFeedback.message} /> : null}
            {testFeedback?.result ? (
              <dl className="detail-list">
                <div>
                  <dt>Region</dt>
                  <dd>{testFeedback.result.region || "-"}</dd>
                </div>
                <div>
                  <dt>Checked</dt>
                  <dd>{formatDateTime(testFeedback.result.checked_at)}</dd>
                </div>
              </dl>
            ) : null}

            <form className="request-form" onSubmit={submitAccount}>
              <div className="form-grid">
                <label className="form-field">
                  <span>Account ID</span>
                  <input
                    value={form.accountID}
                    onChange={(event) => updateForm(setForm, "accountID", event.target.value)}
                    placeholder="12-digit AWS account ID"
                    disabled={!canWriteAws || formMode === "edit"}
                  />
                </label>

                <label className="form-field">
                  <span>Display name</span>
                  <input
                    value={form.displayName}
                    onChange={(event) => updateForm(setForm, "displayName", event.target.value)}
                    disabled={!canWriteAws}
                  />
                </label>

                <label className="form-field">
                  <span>Auth mode</span>
                  <select
                    value={form.authMode}
                    onChange={(event) => updateForm(setForm, "authMode", event.target.value as AwsAccount["auth_mode"])}
                    disabled={!canWriteAws || formMode === "edit"}
                  >
                    <option value="assume_role">Assume role</option>
                    <option value="static">Static keys</option>
                  </select>
                </label>

                <label className="form-field">
                  <span>Role ARN</span>
                  <input
                    value={form.roleARN}
                    onChange={(event) => updateForm(setForm, "roleARN", event.target.value)}
                    placeholder="arn:aws:iam::..."
                    disabled={!canWriteAws || form.authMode !== "assume_role"}
                  />
                </label>

                <label className="form-field">
                  <span>External ID</span>
                  <input
                    value={form.externalID}
                    onChange={(event) => updateForm(setForm, "externalID", event.target.value)}
                    disabled={!canWriteAws || form.authMode !== "assume_role"}
                  />
                </label>

                <label className="form-field">
                  <span>Access key ID</span>
                  <input
                    value={form.accessKeyID}
                    onChange={(event) => updateForm(setForm, "accessKeyID", event.target.value)}
                    disabled={!canWriteAws || form.authMode !== "static"}
                  />
                </label>

                <label className="form-field">
                  <span>Secret access key</span>
                  <input
                    type="password"
                    value={form.secretAccessKey}
                    onChange={(event) => updateForm(setForm, "secretAccessKey", event.target.value)}
                    placeholder={formMode === "edit" ? "Leave empty to keep saved value" : ""}
                    disabled={!canWriteAws || form.authMode !== "static"}
                  />
                </label>

                <label className="form-field">
                  <span>Regions</span>
                  <input
                    value={form.regionAllowlist}
                    onChange={(event) => updateForm(setForm, "regionAllowlist", event.target.value)}
                    placeholder="us-east-1, ap-southeast-1"
                    disabled={!canWriteAws}
                  />
                </label>

                <label className="toggle-row form-toggle-row">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => updateForm(setForm, "enabled", event.target.checked)}
                    disabled={!canWriteAws}
                  />
                  <span>Enabled</span>
                </label>
              </div>

              {formMode === "edit" && isFormDirty ? (
                <div className="notice-row warn">
                  <ShieldCheck size={16} aria-hidden="true" />
                  <span>
                    Test connection exercises the saved configuration, not your unsaved edits. Save first to verify the new values.
                  </span>
                </div>
              ) : null}

              <div className="aws-modal-foot">
                {formMode === "edit" && selectedAccountID ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => testSelectedOrAccount(selectedAccountID)}
                    disabled={!canWriteAws || testAccount.isPending}
                    title={
                      isFormDirty
                        ? "Tests the persisted account, not your unsaved edits."
                        : "Tests the persisted account."
                    }
                  >
                    {testAccount.isPending ? "Testing" : "Test saved connection"}
                  </button>
                ) : null}
                <button type="button" className="secondary-button" onClick={closeAccountModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={!canWriteAws || createAccount.isPending || updateAccount.isPending}
                >
                  <Save size={16} aria-hidden="true" />
                  <span>
                    {createAccount.isPending || updateAccount.isPending
                      ? "Saving"
                      : formMode === "create"
                      ? "Add account"
                      : "Save changes"}
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
