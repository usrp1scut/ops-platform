import {
  Activity,
  Cloud,
  Database,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Network,
  ShieldCheck,
  SquareTerminal,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { ThemeToggle } from "../../components/ThemeToggle";
import { useAuth } from "../../features/auth/AuthProvider";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

const workspaceNav: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/cmdb", label: "CMDB", icon: Database },
  { to: "/sessions", label: "Sessions", icon: SquareTerminal },
  { to: "/access", label: "Access", icon: KeyRound },
  { to: "/connectivity", label: "Connectivity", icon: Network },
];

const platformNav: NavItem[] = [
  { to: "/aws", label: "AWS", icon: Cloud },
  { to: "/iam", label: "IAM", icon: UsersRound },
  { to: "/oidc", label: "OIDC", icon: ShieldCheck },
  { to: "/profile", label: "Profile", icon: UserRound },
];

function NavGroup({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="nav-group">
      <div className="nav-group-title">{title}</div>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </div>
  );
}

export function AppShell() {
  const auth = useAuth();
  const user = auth.identity?.user;
  const displayName = user?.name || user?.email || user?.oidc_subject || "Operator";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">OP</div>
          <div>
            <div className="brand-title">Ops Platform</div>
            <div className="brand-subtitle">Operations console</div>
          </div>
        </div>
        <nav className="side-nav" aria-label="Primary">
          <NavGroup title="Workspace" items={workspaceNav} />
          <NavGroup title="Platform" items={platformNav} />
        </nav>
      </aside>

      <div className="main-frame">
        <header className="topbar">
          <div className="topbar-status">
            <Activity size={18} aria-hidden="true" />
            <span>Operations console</span>
          </div>
          <div className="topbar-user">
            <a
              className="legacy-portal-link"
              href="/portal-legacy/"
              title="Open the previous classic-script console in this tab"
            >
              Old portal
            </a>
            <ThemeToggle />
            <span className="user-name">{displayName}</span>
            <button type="button" className="icon-button" onClick={auth.logout} title="Sign out">
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </header>
        <main className="page-frame">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
