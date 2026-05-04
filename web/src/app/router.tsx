import { createBrowserRouter } from "react-router-dom";

import { AppShell } from "./layout/AppShell";
import { ProtectedRoute } from "./layout/ProtectedRoute";
import { LoginPage } from "../features/auth/LoginPage";
import { AccessPage } from "../features/access/AccessPage";
import { AwsPage } from "../features/aws/AwsPage";
import { AssetsPage } from "../features/cmdb/AssetsPage";
import { ConnectivityPage } from "../features/connectivity/ConnectivityPage";
import { IamPage } from "../features/iam/IamPage";
import { OidcPage } from "../features/oidc/OidcPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { ProfilePage } from "../features/profile/ProfilePage";
import { SessionsPage } from "../features/sessions/SessionsPage";

export const router = createBrowserRouter([
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
        element: <OverviewPage />,
      },
      {
        path: "cmdb",
        element: <AssetsPage />,
      },
      {
        path: "sessions",
        element: <SessionsPage />,
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
]);
