import { AlertCircle, KeyRound, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { beginOidcLogin } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useAuth } from "./AuthProvider";

type RedirectState = {
  from?: {
    pathname: string;
    search: string;
  };
};

function routeFromState(state: unknown) {
  const from = (state as RedirectState | null)?.from;
  if (!from) return "/";
  return `${from.pathname}${from.search || ""}`;
}

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nextPath = routeFromState(location.state);

  if (auth.status === "authenticated") {
    return <Navigate to={nextPath} replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }

    try {
      setSubmitting(true);
      await auth.login({ username: username.trim(), password });
      setPassword("");
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="brand-mark large">OP</div>
          <div>
            <h1 id="login-title">Ops Platform</h1>
            <p>Sign in to continue.</p>
          </div>
        </div>

        <form className="login-form" onSubmit={onSubmit}>
          <label>
            <span>Username</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label>
            <span>Password</span>
            <input
              value={password}
              type="password"
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>

          {error ? (
            <div className="form-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <button type="submit" className="primary-button" disabled={submitting}>
            <KeyRound size={18} aria-hidden="true" />
            <span>{submitting ? "Signing in" : "Sign in"}</span>
          </button>
        </form>

        <button
          type="button"
          className="secondary-button"
          onClick={() => beginOidcLogin(nextPath === "/login" ? "/" : nextPath)}
        >
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Continue with OIDC</span>
        </button>
      </section>
    </main>
  );
}
