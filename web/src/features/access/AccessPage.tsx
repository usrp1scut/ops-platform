import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

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
  const [assetQuery, setAssetQuery] = useState("");
  const [selectedAssetID, setSelectedAssetID] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [durationSeconds, setDurationSeconds] = useState(3600);
  const [createFeedback, setCreateFeedback] = useState<ActionFeedback | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState<ActionFeedback | null>(null);
  const [requestFeedback, setRequestFeedback] = useState<ActionFeedback | null>(null);
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
    <section className="page-section">
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

      <div className="metric-grid">
        {capabilities.map((capability) => {
          const Icon = capability.allowed ? CheckCircle2 : ShieldAlert;
          return (
            <article className="metric-card" key={capability.id}>
              <div className="metric-icon">
                <Icon size={20} aria-hidden="true" />
              </div>
              <div>
                <div className="metric-label">{capability.permission}</div>
                <div className="metric-value compact">{capability.label}</div>
              </div>
              <span className={`status-pill ${capability.allowed ? "ok" : "warn"}`}>
                {capability.allowed ? "available" : "unavailable"}
              </span>
            </article>
          );
        })}
      </div>

      <div className="profile-grid">
        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Requests</p>
              <h2>Request permissions</h2>
            </div>
            <span className="status-pill">{requestPermissions.length}</span>
          </div>
          <PermissionList permissions={requestPermissions} emptyLabel="No request permissions." />
        </article>

        <article className="work-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Grants</p>
              <h2>Grant permissions</h2>
            </div>
            <span className="status-pill">{grantPermissions.length}</span>
          </div>
          <PermissionList permissions={grantPermissions} emptyLabel="No grant permissions." />
        </article>
      </div>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">New request</p>
            <h2>Request asset access</h2>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => void assetSearch.refetch()}
            disabled={!canReadAssets || !canWriteRequests || assetSearch.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{assetSearch.isFetching ? "Refreshing" : "Refresh assets"}</span>
          </button>
        </div>

        {createFeedback ? <PanelState kind={createFeedback.kind} message={createFeedback.message} /> : null}

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

          <div className="form-actions">
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
      </article>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Requests</p>
            <h2>My requests</h2>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => void myRequests.refetch()}
            disabled={!canReadRequests || myRequests.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{myRequests.isFetching ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>

        {requestFeedback ? <PanelState kind={requestFeedback.kind} message={requestFeedback.message} /> : null}

        {!canReadRequests ? (
          <PanelState kind="permission" message="Permission required: bastion.request:read" />
        ) : null}

        {canReadRequests && myRequests.isError ? (
          <PanelState
            kind="error"
            message={myRequests.error instanceof Error ? myRequests.error.message : "Failed to load requests."}
          />
        ) : null}

        {canReadRequests && myRequests.isLoading ? (
          <PanelState kind="loading" message="Loading requests" />
        ) : null}

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

        <Link className="secondary-button compact text-link-button" to="/profile">
          View profile
        </Link>
      </article>

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Approvals</p>
            <h2>Pending approvals</h2>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => void pendingApprovals.refetch()}
            disabled={!canReadRequests || !canApproveRequests || pendingApprovals.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{pendingApprovals.isFetching ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>

        {decisionFeedback ? <PanelState kind={decisionFeedback.kind} message={decisionFeedback.message} /> : null}

        {!canReadRequests ? <PanelState kind="permission" message="Permission required: bastion.request:read" /> : null}

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

      <article className="work-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Grants</p>
            <h2>My active grants</h2>
          </div>
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => void myActiveGrants.refetch()}
            disabled={!canReadGrants || myActiveGrants.isFetching}
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>{myActiveGrants.isFetching ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>

        {!canReadGrants ? (
          <PanelState kind="permission" message="Permission required: bastion.grant:read" />
        ) : null}

        {canReadGrants && myActiveGrants.isError ? (
          <PanelState
            kind="error"
            message={
              myActiveGrants.error instanceof Error ? myActiveGrants.error.message : "Failed to load active grants."
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
    </section>
  );
}
