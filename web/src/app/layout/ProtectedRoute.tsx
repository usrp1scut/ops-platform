import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { useAuth } from "../../features/auth/AuthProvider";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "restoring") {
    return (
      <main className="loading-screen">
        <div className="spinner" aria-hidden="true" />
        <span>Restoring session</span>
      </main>
    );
  }

  if (!auth.token || auth.status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
