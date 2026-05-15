import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Plus, RefreshCw, Send, ShieldAlert, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  approveBastionRequest,
  cancelBastionRequest,
  createBastionRequest,
  listMyActiveBastionGrants,
  listMyBastionRequests,
  listPendingBastionRequests,
  rejectBastionRequest,
  type CreateBastionRequestPayload,
  type BastionRequestDecision,
} from "../../api/bastion";
import { listAssets, type Asset } from "../../api/cmdb";
import { PanelState } from "../../components/PanelState";
import { PermissionList } from "../../components/PermissionList";
import { accessCapabilityState } from "../../lib/access";
import { formatGrantTimeRemaining } from "../../lib/bastionGrants";
import { formatDurationSeconds, requestStatusTone } from "../../lib/bastionRequests";
import { useAuth } from "../auth/AuthProvider";

type DecisionVariables = {
  decision: BastionRequestDecision;
  requestID: string;
};

type ActionFeedback = {
  kind: "error" | "success";
  message: string;
};

const requestDurationOptions = [
  { label: "30 min", value: 1800 },
  { label: "1 hour", value: 3600 },
  { label: "2 hours", value: 7200 },
  { label: "4 hours", value: 14400 },
  { label: "8 hours", value: 28800 },
  { label: "12 hours", value: 43200 },
];

function assetOptionLabel(asset: Asset) {
  const name = asset.name || asset.id;
  const detail = [asset.env, asset.region, asset.private_ip || asset.public_ip].filter(Boolean).join(" / ");

  return detail ? `${name} (${detail})` : name;
}

export function AccessPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [assetQuery, setAssetQuery] = useState("");
  const [selectedAssetID, setSelectedAssetID] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(3600);
  const [createFeedback, setCreateFeedback] = useState<ActionFeedback | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState<ActionFeedback | null>(null);
  const [requestFeedback, setRequestFeedback] = useState<ActionFeedback | null>(null);
  const [requestModalOpen, setRequestModalOpen] = useState(false);

  useEffect(() => {
    document.body.classList.add("fullwidth-mode");
    return () => {
      document.body.classList.remove("fullwidth-mode");
    };
  }, []);
  const identity = auth.identity;
  const userID = identity?.user.id || "";
  const capabilities = accessCapabilityState(identity?.permissions);
  const allowedCount = capabilities.filter((capability) => capability.allowed).length;
  const canReadAssets = auth.can("cmdb.asset:read");
  const canReadRequests = auth.can("bastion.request:read");
  const canWriteRequests = auth.can("bastion.request:write");
  const canReadGrants = auth.can("bastion.grant:read");
  const canApproveRequests = auth.can("bastion.grant:write");
  const requestPermissions = (identity?.permissions || []).filter((permission) =>
    permission.startsWith("bastion.request:"),
  );
  const grantPermissions = (identity?.permissions || []).filter((permission) =>
    permission.startsWith("bastion.grant:"),
  );
  const assetSearch = useQuery({
    queryKey: ["cmdb", "assets", "access-search", userID, assetQuery],
    queryFn: () => listAssets({ query: assetQuery.trim() || undefined, status: "active", limit: 20 }),
    enabled: canReadAssets && canWriteRequests && Boolean(userID),
  });
  const myRequests = useQuery({
    queryKey: ["bastion", "requests", "mine", userID],
    queryFn: () => listMyBastionRequests(50),
    enabled: canReadRequests && Boolean(userID),
  });
  const myActiveGrants = useQuery({
    queryKey: ["bastion", "grants", "active", "mine", userID],
    queryFn: () => listMyActiveBastionGrants(userID, 50),
    enabled: canReadGrants && Boolean(userID),
  });
  const pendingApprovals = useQuery({
    queryKey: ["bastion", "requests", "pending-approvals", userID],
    queryFn: () => listPendingBastionRequests(100),
    enabled: canReadRequests && canApproveRequests && Boolean(userID),
  });
  const assetItems = assetSearch.data?.items || [];
  const requestItems = myRequests.data?.items || [];
  const grantItems = myActiveGrants.data?.items || [];
  const pendingItems = pendingApprovals.data?.items || [];
  const createRequest = useMutation({
    mutationFn: (payload: CreateBastionRequestPayload) => createBastionRequest(payload),
    onMutate: () => {
      setCreateFeedback(null);
    },
    onSuccess: async (created) => {
      setSelectedAssetID("");
      setRequestReason("");
      setDurationSeconds(3600);
      setRequestModalOpen(false);
      setCreateFeedback({
        kind: "success",
        message: `Request created for ${created.asset_name || created.asset_id}.`,
      });
      await queryClient.invalidateQueries({ queryKey: ["bastion"] });
    },
    onError: (error) => {
      setCreateFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to create request.",
      });
    },
  });
  const decideRequest = useMutation({
    mutationFn: async ({ decision, requestID }: DecisionVariables) => {
      if (decision === "approve") {
        await approveBastionRequest(requestID);
        return;
      }
      await rejectBastionRequest(requestID);
    },
    onMutate: () => {
      setDecisionFeedback(null);
    },
    onSuccess: async (_, variables) => {
      setDecisionFeedback({
        kind: "success",
        message: variables.decision === "approve" ? "Request approved." : "Request rejected.",
      });
      await queryClient.invalidateQueries({ queryKey: ["bastion"] });
    },
    onError: (error) => {
      setDecisionFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to update request.",
      });
    },
  });
  const cancelRequest = useMutation({
    mutationFn: cancelBastionRequest,
    onMutate: () => {
      setRequestFeedback(null);
    },
    onSuccess: async () => {
      setRequestFeedback({ kind: "success", message: "Request cancelled." });
      await queryClient.invalidateQueries({ queryKey: ["bastion"] });
    },
    onError: (error) => {
      setRequestFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to cancel request.",
      });
    },
  });

  const tabParam = searchParams.get("tab");
  const accessTab: "mine" | "approve" =
    tabParam === "approve" && canApproveRequests ? "approve" : "mine";
  function setAccessTab(next: "mine" | "approve") {
    const params = new URLSearchParams(searchParams);
    if (next === "mine") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params, { replace: true });
  }
  function openRequestModal() {
    setCreateFeedback(null);
    setRequestModalOpen(true);
  }
  function closeRequestModal() {
    setRequestModalOpen(false);
  }
  function refreshTab() {
    if (accessTab === "approve") {
      void pendingApprovals.refetch();
      return;
    }
    void myRequests.refetch();
    void myActiveGrants.refetch();
  }
  const tabRefreshing =
    accessTab === "approve"
      ? pendingApprovals.isFetching
      : myRequests.isFetching || myActiveGrants.isFetching;

  function createAccessRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const assetID = selectedAssetID.trim();

    if (!assetID) {
      setCreateFeedback({ kind: "error", message: "Select an asset before submitting." });
      return;
    }

    createRequest.mutate({
      asset_id: assetID,
      duration_seconds: durationSeconds,
      reason: requestReason.trim() || undefined,
    });
  }

  function decidePendingRequest(requestID: string, decision: BastionRequestDecision) {
    const label = decision === "approve" ? "approve" : "reject";
    if (!window.confirm(`Are you sure you want to ${label} this request?`)) return;
    decideRequest.mutate({ decision, requestID });
  }

  function cancelOwnRequest(requestID: string) {
    if (!window.confirm("Are you sure you want to cancel this request?")) return;
    cancelRequest.mutate(requestID);
  }

  return (
    <section className="page-section access-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">My access</p>
          <h1>Bastion access</h1>
        </div>
        <span className={`status-pill ${allowedCount > 0 ? "ok" : "warn"}`}>
          <KeyRound size={14} aria-hidden="true" />
          {allowedCount} / {capabilities.length}
        </span>
      </div>

      <div className="access-toolbar">
        <div className="access-toolbar-stats">
          {capabilities.map((capability) => (
            <span className="access-cap" key={capability.id}>
              {capability.allowed ? (
                <CheckCircle2 size={14} className="ok" aria-hidden="true" />
              ) : (
                <ShieldAlert size={14} className="warn" aria-hidden="true" />
              )}
              <span>{capability.label}</span>
            </span>
          ))}
          <span className="access-cap muted" title={`${pendingItems.length} pending approvals`}>
            {pendingItems.length > 0 && canApproveRequests ? (
              <span className="status-pill warn">{pendingItems.length} pending</span>
            ) : null}
          </span>
        </div>
        <div className="access-toolbar-actions">
          <button
            type="button"
            className="secondary-button compact"
            onClick={refreshTab}
            disabled={!canReadRequests || tabRefreshing}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{tabRefreshing ? "Refreshing" : "Refresh"}</span>
          </button>
          <button
            type="button"
            className="primary-button compact"
            onClick={openRequestModal}
            disabled={!canReadAssets || !canWriteRequests}
          >
            <Plus size={14} aria-hidden="true" />
            <span>Request access</span>
          </button>
        </div>
      </div>

      <div className="access-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={accessTab === "mine"}
          className={`access-tab ${accessTab === "mine" ? "active" : ""}`}
          onClick={() => setAccessTab("mine")}
        >
          Mine
        </button>
        {canApproveRequests ? (
          <button
            type="button"
            role="tab"
            aria-selected={accessTab === "approve"}
            className={`access-tab ${accessTab === "approve" ? "active" : ""}`}
            onClick={() => setAccessTab("approve")}
          >
            Approve
            {pendingItems.length > 0 ? <span className="access-tab-badge">{pendingItems.length}</span> : null}
          </button>
        ) : null}
      </div>

      {createFeedback ? <PanelState kind={createFeedback.kind} message={createFeedback.message} /> : null}
      {requestFeedback ? <PanelState kind={requestFeedback.kind} message={requestFeedback.message} /> : null}
      {decisionFeedback && accessTab === "approve" ? (
        <PanelState kind={decisionFeedback.kind} message={decisionFeedback.message} />
      ) : null}

      {accessTab === "mine" ? (
        <>
          <article className="work-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Requests</p>
                <h2>My requests</h2>
              </div>
            </div>

            {!canReadRequests ? (
              <PanelState kind="permission" message="Permission required: bastion.request:read" />
            ) : null}

            {canReadRequests && myRequests.isError ? (
              <PanelState
                kind="error"
                message={myRequests.error instanceof Error ? myRequests.error.message : "Failed to load requests."}
              />
            ) : null}

            {canReadRequests && myRequests.isLoading ? <PanelState kind="loading" message="Loading requests" /> : null}

            {canReadRequests && !myRequests.isLoading && !myRequests.isError && requestItems.length === 0 ? (
              <PanelState kind="empty" message="No requests yet." />
            ) : null}

            {requestItems.length > 0 ? (
              <div className="request-list">
                {requestItems.map((request) => (
                  <article className="request-row" key={request.id}>
                    <div className="request-main">
                      <div>
                        <h3>{request.asset_name || request.asset_id}</h3>
                        <p>{request.reason || "No reason provided."}</p>
                      </div>
                      <div className="request-status-actions">
                        <span className={`status-pill ${requestStatusTone(request.status)}`}>{request.status}</span>
                        {request.status === "pending" && canWriteRequests ? (
                          <button
                            type="button"
                            className="secondary-button compact"
                            onClick={() => cancelOwnRequest(request.id)}
                            disabled={cancelRequest.isPending}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="request-meta">
                      <span>{formatDurationSeconds(request.requested_duration_seconds)}</span>
                      <span>{new Date(request.created_at).toLocaleString()}</span>
                      {request.decided_by_name ? <span>Decided by {request.decided_by_name}</span> : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </article>

          <article className="work-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Grants</p>
                <h2>My active grants</h2>
              </div>
            </div>

            {!canReadGrants ? (
              <PanelState kind="permission" message="Permission required: bastion.grant:read" />
            ) : null}

            {canReadGrants && myActiveGrants.isError ? (
              <PanelState
                kind="error"
                message={
                  myActiveGrants.error instanceof Error
                    ? myActiveGrants.error.message
                    : "Failed to load active grants."
                }
              />
            ) : null}

            {canReadGrants && myActiveGrants.isLoading ? (
              <PanelState kind="loading" message="Loading active grants" />
            ) : null}

            {canReadGrants && !myActiveGrants.isLoading && !myActiveGrants.isError && grantItems.length === 0 ? (
              <PanelState kind="empty" message="No active grants." />
            ) : null}

            {grantItems.length > 0 ? (
              <div className="request-list">
                {grantItems.map((grant) => (
                  <article className="request-row" key={grant.id}>
                    <div className="request-main">
                      <div>
                        <h3>{grant.asset_name || grant.asset_id}</h3>
                        <p>{grant.reason || "No reason provided."}</p>
                      </div>
                      <span className="status-pill ok">active</span>
                    </div>
                    <div className="request-meta">
                      <span>{formatGrantTimeRemaining(grant.expires_at)}</span>
                      <span>Expires {new Date(grant.expires_at).toLocaleString()}</span>
                      {grant.granted_by_name ? <span>Granted by {grant.granted_by_name}</span> : null}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </article>
        </>
      ) : null}

      {accessTab === "approve" ? (
        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Approvals</p>
              <h2>Pending approvals</h2>
            </div>
          </div>

          {!canReadRequests ? (
            <PanelState kind="permission" message="Permission required: bastion.request:read" />
          ) : null}

          {canReadRequests && !canApproveRequests ? (
            <PanelState kind="permission" message="Permission required: bastion.grant:write" />
          ) : null}

          {canReadRequests && canApproveRequests && pendingApprovals.isError ? (
            <PanelState
              kind="error"
              message={
                pendingApprovals.error instanceof Error
                  ? pendingApprovals.error.message
                  : "Failed to load pending approvals."
              }
            />
          ) : null}

          {canReadRequests && canApproveRequests && pendingApprovals.isLoading ? (
            <PanelState kind="loading" message="Loading pending approvals" />
          ) : null}

          {canReadRequests &&
          canApproveRequests &&
          !pendingApprovals.isLoading &&
          !pendingApprovals.isError &&
          pendingItems.length === 0 ? (
            <PanelState kind="empty" message="No pending approvals." />
          ) : null}

          {pendingItems.length > 0 ? (
            <div className="request-list">
              {pendingItems.map((request) => (
                <article className="request-row" key={request.id}>
                  <div className="request-main">
                    <div>
                      <h3>{request.asset_name || request.asset_id}</h3>
                      <p>{request.reason || "No reason provided."}</p>
                    </div>
                    <div className="request-status-actions">
                      <span className={`status-pill ${requestStatusTone(request.status)}`}>{request.status}</span>
                      <div className="request-actions">
                        <button
                          type="button"
                          className="primary-button compact"
                          onClick={() => decidePendingRequest(request.id, "approve")}
                          disabled={decideRequest.isPending}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="secondary-button compact"
                          onClick={() => decidePendingRequest(request.id, "reject")}
                          disabled={decideRequest.isPending}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="request-meta">
                    <span>{request.user_name || request.user_id}</span>
                    <span>{formatDurationSeconds(request.requested_duration_seconds)}</span>
                    <span>{new Date(request.created_at).toLocaleString()}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </article>
      ) : null}

      <details className="access-perms-summary">
        <summary>
          Permission details
          <span className="muted">
            {" "}— {requestPermissions.length} request, {grantPermissions.length} grant
          </span>
        </summary>
        <div className="access-perms-grid">
          <div>
            <p className="eyebrow">Requests</p>
            <PermissionList permissions={requestPermissions} emptyLabel="No request permissions." />
          </div>
          <div>
            <p className="eyebrow">Grants</p>
            <PermissionList permissions={grantPermissions} emptyLabel="No grant permissions." />
          </div>
        </div>
        <Link className="secondary-button compact text-link-button" to="/profile">
          View profile
        </Link>
      </details>

      {requestModalOpen ? (
        <div className="access-modal" role="dialog" aria-modal="true" aria-label="Request asset access">
          <button
            type="button"
            className="access-modal-backdrop"
            aria-label="Close"
            onClick={closeRequestModal}
          />
          <div className="access-modal-card">
            <div className="access-modal-head">
              <div>
                <p className="eyebrow">New request</p>
                <h2>Request asset access</h2>
              </div>
              <button type="button" className="icon-button" onClick={closeRequestModal} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {!canWriteRequests ? (
              <PanelState kind="permission" message="Permission required: bastion.request:write" />
            ) : null}
            {!canReadAssets ? <PanelState kind="permission" message="Permission required: cmdb.asset:read" /> : null}
            {canReadAssets && canWriteRequests && assetSearch.isError ? (
              <PanelState
                kind="error"
                message={assetSearch.error instanceof Error ? assetSearch.error.message : "Failed to load assets."}
              />
            ) : null}
            {createFeedback ? <PanelState kind={createFeedback.kind} message={createFeedback.message} /> : null}

            <form className="request-form" onSubmit={createAccessRequest}>
              <div className="form-grid">
                <label className="form-field">
                  <span>Asset search</span>
                  <input
                    type="search"
                    value={assetQuery}
                    onChange={(event) => setAssetQuery(event.target.value)}
                    placeholder="Name, IP, owner, region"
                    disabled={!canReadAssets || !canWriteRequests}
                  />
                </label>

                <label className="form-field">
                  <span>Asset</span>
                  <select
                    value={selectedAssetID}
                    onChange={(event) => setSelectedAssetID(event.target.value)}
                    disabled={!canReadAssets || !canWriteRequests || assetSearch.isLoading}
                  >
                    <option value="">Select an active asset</option>
                    {assetItems.map((asset) => (
                      <option value={asset.id} key={asset.id}>
                        {assetOptionLabel(asset)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>Duration</span>
                  <select
                    value={durationSeconds}
                    onChange={(event) => setDurationSeconds(Number(event.target.value))}
                    disabled={!canWriteRequests}
                  >
                    {requestDurationOptions.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="form-field">
                <span>Reason</span>
                <textarea
                  value={requestReason}
                  onChange={(event) => setRequestReason(event.target.value)}
                  placeholder="Why do you need access?"
                  rows={3}
                  disabled={!canWriteRequests}
                />
              </label>

              {canReadAssets && canWriteRequests && assetSearch.isLoading ? (
                <PanelState kind="loading" message="Loading active assets" />
              ) : null}

              {canReadAssets &&
              canWriteRequests &&
              !assetSearch.isLoading &&
              !assetSearch.isError &&
              assetItems.length === 0 ? (
                <PanelState kind="empty" message="No active assets match this search." />
              ) : null}

              <div className="access-modal-foot">
                <button type="button" className="secondary-button" onClick={closeRequestModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={!canReadAssets || !canWriteRequests || createRequest.isPending || !selectedAssetID}
                >
                  <Send size={16} aria-hidden="true" />
                  <span>{createRequest.isPending ? "Submitting" : "Request access"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
