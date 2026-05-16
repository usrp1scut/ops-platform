import {
  Activity,
  Cable,
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
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { ThemeToggle } from "../../components/ThemeToggle";
import { useAuth } from "../../features/auth/AuthProvider";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  end?: boolean;
  isAlias?: boolean;
  matchesSearch?: (search: string) => boolean;
};

const operateNav: NavItem[] = [
  { to: "/overview", label: "Overview", icon: LayoutDashboard },
  { to: "/connect", label: "Connect", icon: Cable, badge: "new" },
  {
    to: "/sessions",
    label: "Sessions",
    icon: SquareTerminal,
    matchesSearch: (search) => new URLSearchParams(search).get("mode") !== "audit",
  },
  { to: "/access", label: "Access", icon: KeyRound },
];

const inventoryNav: NavItem[] = [
  { to: "/cmdb", label: "CMDB", icon: Database },
  { to: "/connectivity", label: "Connectivity", icon: Network },
];

const governNav: NavItem[] = [
  { to: "/iam", label: "IAM", icon: UsersRound },
  {
    to: "/audit",
    label: "Audit",
    icon: Activity,
  },
  { to: "/aws", label: "AWS", icon: Cloud },
  { to: "/oidc", label: "OIDC", icon: ShieldCheck },
];

const accountNav: NavItem[] = [
  { to: "/profile", label: "Profile", icon: UserRound },
];

function NavGroup({ title, items }: { title: string; items: NavItem[] }) {
  const location = useLocation();

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
            className={({ isActive }) => {
              const matchesSearch = item.matchesSearch ? item.matchesSearch(location.search) : true;
              const active = !item.isAlias && isActive && matchesSearch;

              return `nav-link${active ? " active" : ""}`;
            }}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
            {item.badge ? (
              <span
                className="status-pill tiny"
                style={{
                  marginLeft: "auto",
                  borderColor: "var(--color-accent-border)",
                  background: "var(--color-accent-bg)",
                  color: "var(--color-accent-hover)",
                }}
              >
                {item.badge}
              </span>
            ) : null}
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
          <NavGroup title="Operate" items={operateNav} />
          <NavGroup title="Inventory" items={inventoryNav} />
          <NavGroup title="Govern" items={governNav} />
        </nav>
        <div style={{ marginTop: "auto" }}>
          <NavGroup title="Account" items={accountNav} />
        </div>
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
