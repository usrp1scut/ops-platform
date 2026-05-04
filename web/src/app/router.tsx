import { createBrowserRouter } from "react-router-dom";

import { AppShell } from "./layout/AppShell";
import { ProtectedRoute } from "./layout/ProtectedRoute";
import { LoginPage } from "../features/auth/LoginPage";
import { AccessPage } from "../features/access/AccessPage";
import { AwsPage } from "../features/aws/AwsPage";
import { AssetsPage } from "../features/cmdb/AssetsPage";
import { IamPage } from "../features/iam/IamPage";
import { OidcPage } from "../features/oidc/OidcPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { ModulePlaceholder } from "../features/placeholder/ModulePlaceholder";
import { ProfilePage } from "../features/profile/ProfilePage";

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
        element: (
          <ModulePlaceholder
            title="Sessions"
            area="Live access"
            permission="cmdb.asset:read"
            workflows={[
              "Live sessions and audit list",
              "Terminal and RDP ticket launch",
              "Session replay availability and recording lookup",
            ]}
          />
        ),
      },
      {
        path: "access",
        element: <AccessPage />,
      },
      {
        path: "connectivity",
        element: (
          <ModulePlaceholder
            title="Connectivity"
            area="Network"
            permission="cmdb.asset:read"
            workflows={[
              "SSH proxy inventory",
              "Host key overrides",
              "SSH keypair management",
            ]}
          />
        ),
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
