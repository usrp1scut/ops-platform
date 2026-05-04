import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { configureApiClient, ApiError } from "../../api/client";
import { getCurrentIdentity, loginLocal, TOKEN_STORAGE_KEY } from "../../api/auth";
import { createPermissionChecker } from "../../lib/permissions";
import type { Identity, IdentityResponse, LocalLoginRequest } from "../../types/auth";

type AuthStatus = "anonymous" | "restoring" | "authenticated";

type AuthContextValue = {
  token: string;
  identity: Identity | null;
  status: AuthStatus;
  login: (payload: LocalLoginRequest) => Promise<Identity>;
  logout: () => void;
  refreshProfile: () => Promise<Identity | null>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function persistToken(token: string) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage can be unavailable in restricted browser modes.
  }
}

function identityFromResponse(response: IdentityResponse): Identity {
  return {
    user: response.user,
    roles: response.roles || [],
    permissions: response.permissions || [],
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(readStoredToken);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() => (readStoredToken() ? "restoring" : "anonymous"));

  const resetAuth = useCallback(() => {
    persistToken("");
    setToken("");
    setIdentity(null);
    setStatus("anonymous");
  }, []);

  useEffect(() => {
    configureApiClient({
      getToken: () => token,
      onUnauthorized: resetAuth,
    });
  }, [resetAuth, token]);

  useEffect(() => {
    let active = true;

    if (!token) {
      setIdentity(null);
      setStatus("anonymous");
      return () => {
        active = false;
      };
    }

    setStatus("restoring");
    getCurrentIdentity()
      .then((response) => {
        if (!active) return;
        setIdentity(identityFromResponse(response));
        setStatus("authenticated");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          resetAuth();
          return;
        }
        setStatus("anonymous");
      });

    return () => {
      active = false;
    };
  }, [resetAuth, token]);

  const login = useCallback(async (payload: LocalLoginRequest) => {
    setStatus("restoring");
    try {
      const response = await loginLocal(payload);
      const nextIdentity = identityFromResponse(response);
      persistToken(response.access_token);
      setToken(response.access_token);
      setIdentity(nextIdentity);
      setStatus("authenticated");
      return nextIdentity;
    } catch (error) {
      setStatus("anonymous");
      throw error;
    }
  }, []);

  const logout = useCallback(() => {
    resetAuth();
  }, [resetAuth]);

  const refreshProfile = useCallback(async () => {
    if (!token) {
      resetAuth();
      return null;
    }

    const response = await getCurrentIdentity();
    const nextIdentity = identityFromResponse(response);
    setIdentity(nextIdentity);
    setStatus("authenticated");
    return nextIdentity;
  }, [resetAuth, token]);

  const can = useMemo(() => createPermissionChecker(identity?.permissions), [identity?.permissions]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      identity,
      status,
      login,
      logout,
      refreshProfile,
      can,
    }),
    [can, identity, login, logout, refreshProfile, status, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
