import { apiRequest } from "./client";

export type SessionAuditRecord = {
  asset_id: string;
  asset_name: string;
  bytes_in: number;
  bytes_out: number;
  client_ip?: string;
  duration_ms?: number;
  ended_at?: string;
  error?: string;
  exit_code?: number;
  has_recording: boolean;
  id: string;
  proxy_id?: string;
  proxy_name?: string;
  recording_bytes?: number;
  started_at: string;
  user_id: string;
  user_name: string;
};

export type ListSessionsOptions = {
  assetID?: string;
  limit?: number;
  offset?: number;
  userID?: string;
};

export type ListSessionsResponse = {
  items: SessionAuditRecord[];
};

export type SessionTicketResponse = {
  expires_at: string;
  ticket: string;
};

export function buildSessionsQuery(options: ListSessionsOptions) {
  const params = new URLSearchParams();

  if (options.userID) params.set("user_id", options.userID);
  if (options.assetID) params.set("asset_id", options.assetID);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));

  return params.toString();
}

export function buildSessionRecordingPath(sessionID: string) {
  return `/api/v1/cmdb/sessions/${encodeURIComponent(sessionID)}/recording`;
}

export function buildAssetTerminalTicketPath(assetID: string) {
  return `/api/v1/cmdb/assets/${encodeURIComponent(assetID)}/terminal/ticket`;
}

export function buildAssetRdpTicketPath(assetID: string) {
  return `/api/v1/cmdb/assets/${encodeURIComponent(assetID)}/rdp/ticket`;
}

export function listSessions(options: ListSessionsOptions = {}) {
  const query = buildSessionsQuery({ limit: 100, ...options });

  return apiRequest<ListSessionsResponse>(`/api/v1/cmdb/sessions/?${query}`);
}

export function getSessionRecording(sessionID: string) {
  return apiRequest<string>(buildSessionRecordingPath(sessionID));
}

export function issueTerminalTicket(assetID: string) {
  return apiRequest<SessionTicketResponse>(buildAssetTerminalTicketPath(assetID), {
    method: "POST",
    body: "{}",
  });
}

export function issueRdpTicket(assetID: string) {
  return apiRequest<SessionTicketResponse>(buildAssetRdpTicketPath(assetID), {
    method: "POST",
    body: "{}",
  });
}
