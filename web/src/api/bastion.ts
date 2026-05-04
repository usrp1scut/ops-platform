import { apiRequest } from "./client";

export type BastionRequestStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired";
export type BastionRequestDecision = "approve" | "reject";
export type BastionRequestAction = BastionRequestDecision | "cancel";

export type BastionRequest = {
  id: string;
  user_id: string;
  user_name: string;
  asset_id: string;
  asset_name: string;
  reason?: string;
  requested_duration_seconds: number;
  status: BastionRequestStatus;
  decided_by_id?: string;
  decided_by_name?: string;
  decided_at?: string;
  decision_reason?: string;
  grant_id?: string;
  created_at: string;
  updated_at: string;
};

type ListBastionRequestsOptions = {
  limit?: number;
  mine?: boolean;
  offset?: number;
  status?: BastionRequestStatus;
  userID?: string;
};

export type BastionGrant = {
  id: string;
  user_id: string;
  user_name: string;
  asset_id: string;
  asset_name: string;
  granted_by_id: string;
  granted_by_name: string;
  reason?: string;
  expires_at: string;
  revoked_at?: string;
  revoked_by_id?: string;
  revoked_by_name?: string;
  revoke_reason?: string;
  request_id?: string;
  created_at: string;
  active: boolean;
};

type ListBastionRequestsResponse = {
  items: BastionRequest[];
};

type ListBastionGrantsResponse = {
  items: BastionGrant[];
};

type DecideBastionRequestPayload = {
  reason?: string;
};

export type CreateBastionRequestPayload = {
  asset_id: string;
  duration_seconds?: number;
  reason?: string;
};

type ApproveBastionRequestResponse = {
  request: BastionRequest;
  grant: BastionGrant;
};

export function buildBastionRequestActionPath(requestID: string, action: BastionRequestAction) {
  return `/api/v1/bastion/requests/${encodeURIComponent(requestID)}/${action}`;
}

export function buildBastionRequestDecisionPath(requestID: string, decision: BastionRequestDecision) {
  return buildBastionRequestActionPath(requestID, decision);
}

export function buildBastionRequestsQuery(options: ListBastionRequestsOptions) {
  const params = new URLSearchParams();

  if (options.mine) params.set("mine", "true");
  if (options.status) params.set("status", options.status);
  if (options.userID) params.set("user_id", options.userID);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));

  return params.toString();
}

export function listMyBastionRequests(limit = 50) {
  const params = buildBastionRequestsQuery({ mine: true, limit });

  return apiRequest<ListBastionRequestsResponse>(`/api/v1/bastion/requests?${params.toString()}`);
}

export function listPendingBastionRequests(limit = 100) {
  const params = buildBastionRequestsQuery({ status: "pending", limit });

  return apiRequest<ListBastionRequestsResponse>(`/api/v1/bastion/requests?${params.toString()}`);
}

export function listMyActiveBastionGrants(userID: string, limit = 50) {
  const params = new URLSearchParams({
    active: "true",
    user_id: userID,
    limit: String(limit),
  });

  return apiRequest<ListBastionGrantsResponse>(`/api/v1/bastion/grants?${params.toString()}`);
}

export function createBastionRequest(payload: CreateBastionRequestPayload) {
  return apiRequest<BastionRequest>("/api/v1/bastion/requests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function approveBastionRequest(requestID: string, payload: DecideBastionRequestPayload = {}) {
  return apiRequest<ApproveBastionRequestResponse>(buildBastionRequestDecisionPath(requestID, "approve"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function rejectBastionRequest(requestID: string, payload: DecideBastionRequestPayload = {}) {
  return apiRequest<BastionRequest>(buildBastionRequestDecisionPath(requestID, "reject"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function cancelBastionRequest(requestID: string) {
  return apiRequest<BastionRequest>(buildBastionRequestActionPath(requestID, "cancel"), {
    method: "POST",
    body: "{}",
  });
}
