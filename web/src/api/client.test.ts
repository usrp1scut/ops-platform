import { afterEach, describe, expect, it, vi } from "vitest";

import { apiRequest, ApiError, configureApiClient } from "./client";

describe("apiRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    configureApiClient({
      getToken: () => "",
      onUnauthorized: () => undefined,
    });
  });

  it("attaches bearer tokens to protected requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    configureApiClient({
      getToken: () => "test-token",
      onUnauthorized: () => undefined,
    });

    await apiRequest<{ ok: boolean }>("/api/v1/example");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("normalizes errors and invokes the unauthorized hook on protected 401 responses", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid token" }), { status: 401 })),
    );
    configureApiClient({
      getToken: () => "expired-token",
      onUnauthorized,
    });

    await expect(apiRequest("/auth/me")).rejects.toMatchObject({
      message: "invalid token",
      status: 401,
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the unauthorized hook for skipAuth requests", async () => {
    const onUnauthorized = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "bad credentials" }), { status: 401 })),
    );
    configureApiClient({
      getToken: () => "expired-token",
      onUnauthorized,
    });

    await expect(apiRequest("/auth/local/login", { skipAuth: true })).rejects.toMatchObject({
      message: "bad credentials",
      status: 401,
    });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("returns a raw string when responseType is 'text', even when the body parses as JSON", async () => {
    // A header-only asciicast file is technically valid JSON, so the
    // default JSON-first parser would hand the caller an object and
    // break callers that expect a string (e.g. parseAsciicast).
    const headerOnlyCast = JSON.stringify({ version: 2, width: 80, height: 24 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(headerOnlyCast, { status: 200 })));

    const result = await apiRequest<string>("/api/v1/cmdb/sessions/abc/recording", {
      responseType: "text",
    });

    expect(typeof result).toBe("string");
    expect(result).toBe(headerOnlyCast);
  });

  it("still parses error responses as JSON when responseType is 'text'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "recording not found" }), { status: 404 }),
      ),
    );

    await expect(
      apiRequest("/api/v1/cmdb/sessions/missing/recording", { responseType: "text" }),
    ).rejects.toMatchObject({
      message: "recording not found",
      status: 404,
    });
  });
});
