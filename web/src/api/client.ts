type ApiAuthConfig = {
  getToken: () => string;
  onUnauthorized: () => void;
};

export type ApiRequestOptions = RequestInit & {
  skipAuth?: boolean;
};

let authConfig: ApiAuthConfig = {
  getToken: () => "",
  onUnauthorized: () => undefined,
};

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export function configureApiClient(config: Partial<ApiAuthConfig>) {
  authConfig = { ...authConfig, ...config };
}

function hasRequestBody(body: BodyInit | null | undefined) {
  return body !== undefined && body !== null;
}

function shouldSendJsonContentType(body: BodyInit | null | undefined) {
  return hasRequestBody(body) && !(body instanceof FormData);
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(payload: unknown) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const data = payload as Record<string, unknown>;
    const value = data.error || data.message || data.detail;
    if (typeof value === "string" && value.trim()) return value;
  }
  return "Request failed";
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { skipAuth, headers: inputHeaders, ...init } = options;
  const headers = new Headers(inputHeaders);

  if (shouldSendJsonContentType(init.body) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = authConfig.getToken();
  if (!skipAuth && token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, {
    method: "GET",
    ...init,
    headers,
  });
  const payload = await parseResponse(response);

  if (!response.ok) {
    if (response.status === 401 && !skipAuth) {
      authConfig.onUnauthorized();
    }
    throw new ApiError(errorMessage(payload), response.status, payload);
  }

  return payload as T;
}
