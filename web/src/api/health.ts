import { apiRequest } from "./client";

export type HealthResponse = {
  status: "ok" | "error";
  error?: string;
};

export function getHealth() {
  return apiRequest<HealthResponse>("/healthz", { skipAuth: true });
}
