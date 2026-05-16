import { Navigate, createBrowserRouter, useLocation } from "react-router-dom";

import { AppShell } from "./layout/AppShell";
import { ProtectedRoute } from "./layout/ProtectedRoute";
import { LoginPage } from "../features/auth/LoginPage";
import { AccessPage } from "../features/access/AccessPage";
import { AuditPage } from "../features/audit/AuditPage";
import { AwsPage } from "../features/aws/AwsPage";
import { AssetsPage } from "../features/cmdb/AssetsPage";
import { ConnectPage } from "../features/connect/ConnectPage";
import { ConnectivityPage } from "../features/connectivity/ConnectivityPage";
import { IamPage } from "../features/iam/IamPage";
import { OidcPage } from "../features/oidc/OidcPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { SessionsPage } from "../features/sessions/SessionsPage";
import { appBasename } from "../lib/basename";

function SessionsRoute() {
  const location = useLocation();
  const mode = new URLSearchParams(location.search).get("mode");

  if (mode === "audit") {
    const params = new URLSearchParams(location.search);
    params.delete("mode");
    const query = params.toString();
    return <Navigate to={query ? `/audit?${query}` : "/audit"} replace />;
  }

  return <SessionsPage />;
}

export const router = createBrowserRouter(
  [
    {
      path: "/login",
      element: <LoginPage />,
    },
    {
      path: "/",
      element: (
        <ProtectedRoute>
          <AppShell />
        </ProtectedRoute>
      ),
      children: [
        {
          index: true,
          element: <Navigate to="/connect" replace />,
        },
        {
          path: "connect",
          element: <ConnectPage />,
        },
        {
          path: "overview",
          element: <OverviewPage />,
        },
        {
          path: "cmdb",
          element: <AssetsPage />,
        },
        {
          path: "sessions",
          element: <SessionsRoute />,
        },
        {
          path: "audit",
          element: <AuditPage />,
        },
        {
          path: "access",
          element: <AccessPage />,
        },
        {
          path: "connectivity",
          element: <ConnectivityPage />,
        },
        {
          path: "aws",
          element: <AwsPage />,
        },
        {
          path: "iam",
          element: <IamPage />,
        },
        {
          path: "oidc",
          element: <OidcPage />,
        },
        {
          path: "profile",
          element: <ProfilePage />,
        },
      ],
    },
  ],
  {
    basename: appBasename(import.meta.env.BASE_URL),
  },
);
