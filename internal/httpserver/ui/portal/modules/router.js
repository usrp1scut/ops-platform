// Section + subsection routing for the redesigned portal shell.
//
// The portal uses a two-level routing model: a top-level "section" plus an
// optional "subsection". Old code paths and embedded `data-nav="..."` links
// still call setView with single legacy strings ("cmdb", "grants", etc.);
// LEGACY_ROUTES resolves those to the new shape so we don't have to chase
// every call site at once.
//
// Depends on (from app.js): state, elements, applyConnectivityTab,
// setSessionsPane, loadSessions, renderSessionsView, loadSidebarAssets,
// startSessionsAutoRefresh, stopSessionsAutoRefresh, refreshGrantsView.

const ROUTER_CONNECTIVITY_TABS = ["bastions", "proxies", "hostkeys", "keypairs"];

// SUB_NAV declares the IA in one place. Adding a section is one entry.
// `view` names the underlying <article id="view-*"> that holds the pane.
const SUB_NAV = {
  overview: { panes: [{ id: "overview", label: "Overview", view: "overview" }] },
  assets: {
    panes: [
      { id: "inventory",    label: "Inventory",    view: "cmdb" },
      { id: "connectivity", label: "Connectivity", view: "connectivity" },
    ],
  },
  sessions: {
    panes: [
      { id: "live",  label: "Live",  view: "sessions", sessionsPane: "live" },
      { id: "audit", label: "Audit", view: "sessions", sessionsPane: "audit" },
    ],
  },
  access: {
    panes: [
      { id: "my-requests",   label: "My requests",       view: "grants", accessTab: "my-requests" },
      { id: "pending",       label: "Pending approvals", view: "grants", accessTab: "pending" },
      { id: "active-grants", label: "Active grants",     view: "grants", accessTab: "active-grants" },
    ],
  },
  platform: {
    panes: [
      { id: "cloud-accounts", label: "Cloud accounts", view: "aws" },
      { id: "iam",            label: "IAM",            view: "iam" },
      { id: "oidc",           label: "OIDC",           view: "oidc" },
    ],
  },
  profile: { panes: [{ id: "profile", label: "Profile", view: "profile" }] },
};

const LEGACY_ROUTES = {
  cmdb:         ["assets",   "inventory"],
  connectivity: ["assets",   "connectivity"],
  bastions:     ["assets",   "connectivity"],
  proxies:      ["assets",   "connectivity"],
  hostkeys:     ["assets",   "connectivity"],
  keypairs:     ["assets",   "connectivity"],
  grants:       ["access",   "my-requests"],
  aws:          ["platform", "cloud-accounts"],
  iam:          ["platform", "iam"],
};

function rememberSubsection(section, subsection) {
  try { localStorage.setItem("ops_platform_subsection_" + section, subsection); } catch (_) {}
}
function recallSubsection(section) {
  try { return localStorage.getItem("ops_platform_subsection_" + section); } catch (_) { return null; }
}

// setView accepts either the new (section, subsection) pair or a legacy
// single string. Omitted subsection falls back to the remembered choice
// or the section's first pane.
function setView(section, subsection) {
  if (section && !SUB_NAV[section] && LEGACY_ROUTES[section]) {
    const isConnTab = ROUTER_CONNECTIVITY_TABS.includes(section);
    const orig = section;
    const mapped = LEGACY_ROUTES[section];
    section = mapped[0];
    subsection = subsection || mapped[1];
    if (isConnTab) {
      state.connectivityTab = orig;
      try { localStorage.setItem("ops_platform_connectivity_tab", orig); } catch (_) {}
    }
  }
  if (!SUB_NAV[section]) section = "overview";

  const cfg = SUB_NAV[section];
  if (!subsection) subsection = recallSubsection(section) || cfg.panes[0].id;
  if (!cfg.panes.find((p) => p.id === subsection)) subsection = cfg.panes[0].id;
  rememberSubsection(section, subsection);

  const pane = cfg.panes.find((p) => p.id === subsection);
  state.view = section;
  state.subsection = subsection;

  elements.navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.view === section);
  });
  elements.views.forEach((node) => {
    node.classList.toggle("active", node.id === "view-" + pane.view);
  });

  renderSubNav(section, subsection);

  if (pane.view === "connectivity") {
    applyConnectivityTab(state.connectivityTab || "bastions");
  }
  // Sessions is a workspace, not a regular page: drop the centered max-width
  // and the standard padding for the duration of the section. This is the
  // hook for Redesign §6.3 / §7.4 — full-width layout when the user is in
  // an operator tool.
  const main = document.querySelector(".main");
  if (main) main.classList.toggle("main-workspace", section === "sessions");
  if (section === "sessions") {
    if (typeof setSessionsPane === "function") setSessionsPane(pane.sessionsPane || "live");
    if (typeof applySessionsLayout === "function") applySessionsLayout(pane.sessionsPane || "live");
    loadSessions().then(renderSessionsView);
    // The asset rail only matters when the user can launch new sessions,
    // which is the Live subsection. On Audit the rail is hidden via the
    // .audit-mode class set by applySessionsLayout.
    if (pane.sessionsPane !== "audit") loadSidebarAssets();
    // Auto-refresh defaults differ: Live polls every 10s for new active
    // sessions; Audit is browse-only and doesn't need polling.
    if (pane.sessionsPane === "audit") {
      stopSessionsAutoRefresh();
    } else {
      startSessionsAutoRefresh();
    }
  } else {
    stopSessionsAutoRefresh();
  }
  if (section === "access") {
    state.accessTab = pane.accessTab || "my-requests";
    refreshGrantsView();
  }

  const target = "#" + section + "/" + subsection;
  if (location.hash !== target) {
    try { history.replaceState(null, "", target); } catch (_) { location.hash = target; }
  }
}

function renderSubNav(section, subsection) {
  const cfg = SUB_NAV[section];
  document.querySelectorAll(".section-subnav").forEach((n) => n.remove());
  if (!cfg || cfg.panes.length <= 1) return;
  const pane = cfg.panes.find((p) => p.id === subsection) || cfg.panes[0];
  const article = document.getElementById("view-" + pane.view);
  if (!article) return;
  const header = article.querySelector(".page-header");
  if (!header) return;
  const strip = document.createElement("div");
  strip.className = "section-subnav";
  strip.setAttribute("role", "tablist");
  strip.innerHTML = cfg.panes.map((p) => (
    '<button class="section-subnav-tab' + (p.id === subsection ? " active" : "") +
    '" data-subsection="' + p.id + '" role="tab" aria-selected="' + (p.id === subsection) + '">' +
    p.label + "</button>"
  )).join("");
  strip.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-subsection]");
    if (!btn) return;
    setView(section, btn.dataset.subsection);
  });
  header.parentNode.insertBefore(strip, header.nextSibling);
}

function parseHashRoute() {
  const raw = (location.hash || "").replace(/^#/, "");
  if (!raw) return { section: "overview", subsection: undefined };
  const [section, subsection] = raw.split("/", 2);
  return { section, subsection };
}
