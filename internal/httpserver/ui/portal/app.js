const TOKEN_KEY = "ops_platform_access_token";

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: null,
    roles: [],
    permissions: [],
    assets: [],
    assetTotal: 0,
    assetQuery: { env: "", type: "", status: "", source: "", region: "", criticality: "", q: "", limit: 25, offset: 0, includeBastions: false },
    assetViewMode: localStorage.getItem("ops_platform_asset_view_mode") === "tree" ? "tree" : "list",
    treeExpanded: {},
    assetDrawer: { open: false, asset: null, labels: [], connection: null, probe: null, relations: [], connEdit: null, busy: "" },
    sshProxies: [],
    proxyForm: null,
    proxyFormBusy: false,
    hostkeys: [],
    keypairs: [],
    keypairForm: { open: false, busy: false },
    sessions: [],
    sidebarAssets: [],
    sidebarSearch: "",
    bastions: [],
    bastionQuery: { env: "", region: "", status: "", q: "" },
    connectivityTab: localStorage.getItem("ops_platform_connectivity_tab") || "bastions",
    awsAccounts: [],
    awsSyncRuns: [],
    awsSyncStatus: null,
    oidcSettings: null,
    iamUsers: [],
    iamRoles: [],
    selectedUserID: "",
    selectedUserIdentity: null,
    view: "overview",
    activity: [],
    health: { api: null, db: null },
  };

  const $ = (id) => document.getElementById(id);

  const elements = {
    authGate: $("auth-gate"),
    workspace: $("workspace"),
    authErrorBox: $("auth-error"),
    userBadge: $("user-badge"),
    userRoleText: $("user-role-text"),
    userAvatar: $("user-avatar"),
    logoutBtn: $("logout-btn"),
    themeToggleBtn: $("theme-toggle-btn"),
    localLoginForm: $("local-login-form"),
    localUsername: $("local-username"),
    localPassword: $("local-password"),
    oidcLoginBtn: $("oidc-login-btn"),

    navItems: document.querySelectorAll(".nav-item"),
    views: document.querySelectorAll(".view"),

    metricAssets: $("metric-assets"),
    metricAccounts: $("metric-accounts"),
    metricRoles: $("metric-roles"),
    metricWrite: $("metric-write"),

    refreshOverviewBtn: $("refresh-overview-btn"),
    healthList: $("health-list"),
    activityList: $("activity-list"),

    assetSearch: $("asset-search"),
    refreshAssetsBtn: $("refresh-assets-btn"),
    assetsTableBody: $("assets-table-body"),
    assetsCountHint: $("assets-count-hint"),
    assetsPagination: $("assets-pagination"),
    assetsListWrap: $("assets-list-wrap"),
    assetsTree: $("assets-tree"),
    assetsViewToggle: $("assets-view-toggle"),
    toggleAssetFormBtn: $("toggle-asset-form-btn"),
    filterEnv: $("filter-env"),
    filterType: $("filter-type"),
    filterStatus: $("filter-status"),
    filterSource: $("filter-source"),
    filterRegion: $("filter-region"),
    filterResetBtn: $("filter-reset-btn"),
    assetDrawer: $("asset-drawer"),
    assetDrawerEyebrow: $("asset-drawer-eyebrow"),
    assetDrawerTitle: $("asset-drawer-title"),
    assetDrawerSub: $("asset-drawer-sub"),
    assetDrawerBody: $("asset-drawer-body"),

    refreshAwsBtn: $("refresh-aws-btn"),
    cloudAccountsBody: $("cloud-accounts-body"),
    toggleAwsFormBtn: $("toggle-aws-form-btn"),
    triggerAwsSyncBtn: $("trigger-aws-sync-btn"),
    refreshSyncBtn: $("refresh-sync-btn"),
    syncStatusCard: $("sync-status-card"),
    syncRunsBody: $("sync-runs-body"),

    iamUserSearch: $("iam-user-search"),
    refreshIamUsersBtn: $("refresh-iam-users-btn"),
    iamUsersTableBody: $("iam-users-table-body"),
    refreshIamSelectionBtn: $("refresh-iam-selection-btn"),
    iamSelectedUser: $("iam-selected-user"),
    iamRoleSelect: $("iam-role-select"),
    iamBindRoleBtn: $("iam-bind-role-btn"),
    iamUserRoles: $("iam-user-roles"),
    refreshIamRolesBtn: $("refresh-iam-roles-btn"),
    iamRolesTableBody: $("iam-roles-table-body"),
    iamRolePermissionsOutput: $("iam-role-permissions-output"),

    refreshOIDCSettingsBtn: $("refresh-oidc-settings-btn"),
    testOIDCSettingsBtn: $("test-oidc-settings-btn"),
    oidcSettingsForm: $("oidc-settings-form"),
    oidcEnabledInput: $("oidc-enabled-input"),
    oidcIssuerURLInput: $("oidc-issuer-url-input"),
    oidcClientIDInput: $("oidc-client-id-input"),
    oidcClientSecretInput: $("oidc-client-secret-input"),
    oidcRedirectURLInput: $("oidc-redirect-url-input"),
    oidcAuthorizeURLInput: $("oidc-authorize-url-input"),
    oidcTokenURLInput: $("oidc-token-url-input"),
    oidcUserInfoURLInput: $("oidc-userinfo-url-input"),
    oidcScopesInput: $("oidc-scopes-input"),

    refreshProfileBtn: $("refresh-profile-btn"),
    identityOutput: $("identity-output"),
    permissionChips: $("permission-chips"),

    toastHost: $("toast-host"),
  };

  // ===== Utils =====

  function safe(input) {
    return String(input == null ? "" : input)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function setToken(value) {
    state.token = value || "";
    if (state.token) {
      localStorage.setItem(TOKEN_KEY, state.token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  function hasPermission(permission) {
    return state.permissions.includes(permission) || state.permissions.includes("system:admin");
  }

  const canReadIAM = () => hasPermission("iam.user:read");
  const canWriteIAM = () => hasPermission("iam.user:write");
  const writeAccess = () =>
    hasPermission("cmdb.asset:write") || hasPermission("aws.account:write") || canWriteIAM();

  function initials(value) {
    const v = String(value || "").trim();
    if (!v) return "?";
    const parts = v.split(/[\s@._-]+/).filter(Boolean);
    if (parts.length === 0) return v.slice(0, 1).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function formatRelative(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const diff = Date.now() - date.getTime();
    const s = Math.round(diff / 1000);
    if (s < 60) return s + "s ago";
    const m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    const d = Math.round(h / 24);
    return d + "d ago";
  }

  function parseCSV(csv) {
    if (!csv || !csv.trim()) return [];
    return csv.split(",").map((i) => i.trim()).filter(Boolean);
  }

  function parseScopes(csv) {
    if (!csv || !csv.trim()) return ["openid", "profile", "email"];
    const set = new Set();
    parseCSV(csv).forEach((item) => set.add(item));
    return Array.from(set);
  }

  // ===== Toast =====

  function toast(message, kind) {
    const node = document.createElement("div");
    node.className = "toast " + (kind || "");
    const icon = kind === "error"
      ? '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5v0.5"/></svg>'
      : kind === "success"
      ? '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg>'
      : '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16v0.5"/></svg>';
    node.innerHTML = icon + '<div class="toast-body">' + safe(message) + "</div>";
    elements.toastHost.appendChild(node);
    setTimeout(() => {
      node.style.opacity = "0";
      node.style.transition = "opacity 0.2s";
      setTimeout(() => node.remove(), 200);
    }, 3200);
  }

  function showAuthError(message) {
    if (!message) {
      elements.authErrorBox.classList.remove("visible");
      elements.authErrorBox.textContent = "";
      return;
    }
    elements.authErrorBox.textContent = message;
    elements.authErrorBox.classList.add("visible");
  }

  function logActivity(message, kind) {
    const entry = {
      time: new Date(),
      message: message,
      kind: kind || "info",
    };
    state.activity.unshift(entry);
    state.activity = state.activity.slice(0, 24);
    renderActivity();
  }

  // ===== View routing =====
  // The router (setView, SUB_NAV, LEGACY_ROUTES, renderSubNav,
  // parseHashRoute) lives in modules/router.js. Per-pane side effects
  // (applyConnectivityTab below, setSessionsPane in the live-session
  // section, refreshGrantsView in modules/grants.js) are still defined
  // here / in their feature modules; the router just orchestrates them.

  const CONNECTIVITY_TABS = ["bastions", "proxies", "hostkeys", "keypairs"];

  function applyConnectivityTab(tab) {
    if (!CONNECTIVITY_TABS.includes(tab)) tab = "bastions";
    state.connectivityTab = tab;
    try { localStorage.setItem("ops_platform_connectivity_tab", tab); } catch (_) {}
    document.querySelectorAll(".connectivity-tab").forEach((btn) => {
      const active = btn.dataset.connTab === tab;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".connectivity-pane").forEach((pane) => {
      pane.hidden = pane.id !== "view-" + tab;
    });
    if (tab === "bastions") {
      refreshBastions();
    } else if (tab === "proxies") {
      loadSSHProxies().then(renderProxiesView);
    } else if (tab === "hostkeys") {
      loadHostKeys().then(renderHostKeysView);
    } else if (tab === "keypairs") {
      loadKeypairs().then(renderKeypairsView);
    }
  }

  function bindConnectivityTabs() {
    const switcher = document.getElementById("connectivity-tab-switcher");
    if (!switcher || switcher.dataset.bound) return;
    switcher.dataset.bound = "1";
    switcher.addEventListener("click", (e) => {
      const btn = e.target.closest(".connectivity-tab[data-conn-tab]");
      if (!btn) return;
      applyConnectivityTab(btn.dataset.connTab);
    });
  }

  // ===== Time + format helpers =====

  function relativeTime(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return safe(iso);
    const diff = Math.round((Date.now() - t) / 1000);
    if (diff < 0) return "in " + Math.abs(diff) + "s";
    if (diff < 60) return diff + "s ago";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  }

  function formatBytes(n) {
    if (n == null) return "-";
    if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    if (n > 1024) return (n / 1024).toFixed(1) + " KB";
    return String(n) + " B";
  }

  function formatDuration(ms) {
    if (!ms || ms < 0) return "-";
    if (ms < 1000) return ms + "ms";
    const s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return m + "m " + rem + "s";
    return Math.floor(m / 60) + "h " + (m % 60) + "m";
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => toast("Copied", "success"),
        () => toast("Copy failed", "error"),
      );
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copied", "success"); }
    catch (e) { toast("Copy failed", "error"); }
    document.body.removeChild(ta);
  }

  // ===== Sessions =====

  // sessionsFilter state. status is one of: "", "active", "closed", "error".
  // The legacy onlyActive boolean still exists so external code that toggles
  // it directly keeps working — it maps to status === "active".
  const sessionsFilter = { user: "", asset: "", onlyActive: false, status: "" };
  let sessionsRefreshHandle = null;

  async function loadSessions() {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (sessionsFilter.user.trim()) params.set("user_id", sessionsFilter.user.trim());
      if (sessionsFilter.asset.trim()) params.set("asset_id", sessionsFilter.asset.trim());
      const res = await api("/api/v1/cmdb/sessions/?" + params.toString());
      state.sessions = Array.isArray(res.items) ? res.items : [];
    } catch (err) {
      state.sessions = [];
      logActivity("Load sessions failed: " + err.message, "error");
    }
  }

  function startSessionsAutoRefresh() {
    stopSessionsAutoRefresh();
    sessionsRefreshHandle = setInterval(() => {
      if (state.view !== "sessions") return;
      loadSessions().then(renderSessionsView);
    }, 10000);
  }

  function stopSessionsAutoRefresh() {
    if (sessionsRefreshHandle) {
      clearInterval(sessionsRefreshHandle);
      sessionsRefreshHandle = null;
    }
  }

  function filteredSessions() {
    const wantStatus = sessionsFilter.status || (sessionsFilter.onlyActive ? "active" : "");
    return (state.sessions || []).filter((s) => {
      if (!wantStatus) return true;
      if (wantStatus === "active") return !s.ended_at;
      if (wantStatus === "closed") return !!s.ended_at && !s.error;
      if (wantStatus === "error")  return !!s.error;
      return true;
    });
  }

  function renderSessionsView() {
    const pane = document.getElementById("sessions-pane-audit");
    if (!pane) return;
    const items = filteredSessions();
    const active = (state.sessions || []).filter((s) => !s.ended_at).length;

    const rows = items.map((s) => {
      const status = s.ended_at
        ? (s.error
            ? '<span class="badge error">error</span>'
            : '<span class="badge success">closed' + (s.exit_code != null ? ' · ' + s.exit_code : '') + '</span>')
        : '<span class="badge info pulse">active</span>';
      const dur = formatDuration(s.duration_ms);
      const proxy = s.proxy_name ? '<div class="sub muted">via ' + safe(s.proxy_name) + '</div>' : '';
      const errCell = s.error
        ? '<td class="muted" title="' + safe(s.error) + '">' + safe(s.error.length > 60 ? s.error.slice(0, 60) + "…" : s.error) + '</td>'
        : '<td></td>';
      const actions = [];
      if (s.has_recording) {
        actions.push(
          '<button class="btn ghost small" data-replay-id="' + safe(s.id) +
          '" data-replay-label="' + safe((s.user_name || s.user_id) + " @ " + (s.asset_name || s.asset_id)) +
          '" title="Replay session">▶ Replay</button>'
        );
      }
      if (s.asset_id) {
        // "Open related asset" — drops the user on the inventory drawer
        // for the asset the session ran against. Saves a tab-switch + UUID
        // copy/paste round-trip during incident review.
        actions.push(
          '<button class="btn ghost small" data-open-asset="' + safe(s.asset_id) +
          '" title="Open asset detail">Open asset</button>'
        );
      }
      const actionsCell = actions.length
        ? '<td class="row-actions">' + actions.join(" ") + '</td>'
        : '<td class="muted">—</td>';
      return '<tr>' +
        '<td title="' + safe(s.started_at) + '">' + safe(relativeTime(s.started_at)) + '</td>' +
        '<td>' + safe(s.user_name || s.user_id) + '</td>' +
        '<td>' + safe(s.asset_name || s.asset_id) + proxy + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' + dur + '</td>' +
        '<td>' + formatBytes(s.bytes_in) + ' / ' + formatBytes(s.bytes_out) + '</td>' +
        '<td>' + safe(s.client_ip) + '</td>' +
        actionsCell +
        errCell +
      '</tr>';
    }).join("");

    // Filter chips show the currently active filters and let the user
    // clear individual fields with a click. Mirrors the inventory chip
    // pattern (Phase 2).
    const chipParts = [];
    const pushChip = (field, label, value) => {
      chipParts.push(
        '<span class="filter-chip" data-session-chip="' + safe(field) + '">' +
          '<span class="filter-chip-key">' + safe(label) + ':</span>' +
          '<span class="filter-chip-value">' + safe(value) + '</span>' +
          '<button type="button" class="filter-chip-clear" aria-label="Clear ' + safe(label) + '">×</button>' +
        '</span>'
      );
    };
    if (sessionsFilter.user)   pushChip("user", "user", sessionsFilter.user);
    if (sessionsFilter.asset)  pushChip("asset", "asset", sessionsFilter.asset);
    const effStatus = sessionsFilter.status || (sessionsFilter.onlyActive ? "active" : "");
    if (effStatus) pushChip("status", "status", effStatus);
    const chipBar = chipParts.length
      ? '<div class="filter-chips">' + chipParts.join("") +
        '<button type="button" class="filter-chip-reset">Clear all</button></div>'
      : "";

    pane.innerHTML =
      '<div class="kpi-grid"><div class="kpi"><div class="kpi-label">Shown</div><div class="kpi-value">' + items.length + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Active now</div><div class="kpi-value">' + active + '</div></div></div>' +
      '<div class="toolbar">' +
        '<input id="sessions-user" class="input" placeholder="Filter by user UUID" value="' + safe(sessionsFilter.user) + '" />' +
        '<input id="sessions-asset" class="input" placeholder="Filter by asset UUID" value="' + safe(sessionsFilter.asset) + '" />' +
        '<select id="sessions-status">' +
          '<option value=""' + (effStatus === "" ? " selected" : "") + '>All statuses</option>' +
          '<option value="active"' + (effStatus === "active" ? " selected" : "") + '>Active</option>' +
          '<option value="closed"' + (effStatus === "closed" ? " selected" : "") + '>Closed</option>' +
          '<option value="error"' + (effStatus === "error" ? " selected" : "") + '>Error</option>' +
        '</select>' +
        '<button id="sessions-apply" class="btn">Apply</button>' +
        '<button id="sessions-refresh" class="btn ghost">Refresh</button>' +
      '</div>' +
      chipBar +
      (items.length === 0
        ? '<div class="empty-state">No sessions match the current filters.</div>'
        : '<table class="table"><thead><tr><th>Started</th><th>User</th><th>Asset</th><th>Status</th><th>Duration</th><th>In / Out</th><th>Client IP</th><th>Actions</th><th>Error</th></tr></thead><tbody>' + rows + '</tbody></table>');

    pane.querySelectorAll("button[data-replay-id]").forEach((btn) => {
      btn.addEventListener("click", () => openReplayModal(btn.dataset.replayId, btn.dataset.replayLabel));
    });
    pane.querySelectorAll("button[data-open-asset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.openAsset;
        if (!id) return;
        setView("assets", "inventory");
        // Defer the drawer open until the inventory view is in the DOM.
        setTimeout(() => openAssetDrawer(id), 0);
      });
    });

    const refresh = pane.querySelector("#sessions-refresh");
    if (refresh) refresh.addEventListener("click", () => loadSessions().then(renderSessionsView));

    const userInput = pane.querySelector("#sessions-user");
    const assetInput = pane.querySelector("#sessions-asset");
    const statusSel = pane.querySelector("#sessions-status");
    const applyBtn = pane.querySelector("#sessions-apply");
    const apply = () => {
      sessionsFilter.user = (userInput && userInput.value) || "";
      sessionsFilter.asset = (assetInput && assetInput.value) || "";
      sessionsFilter.status = (statusSel && statusSel.value) || "";
      sessionsFilter.onlyActive = sessionsFilter.status === "active";
      loadSessions().then(renderSessionsView);
    };
    if (applyBtn) applyBtn.addEventListener("click", apply);
    [userInput, assetInput].forEach((el) => {
      if (!el) return;
      el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") apply(); });
    });
    if (statusSel) statusSel.addEventListener("change", apply);

    // Wire chip × buttons.
    pane.querySelectorAll(".filter-chip").forEach((chip) => {
      const clear = chip.querySelector(".filter-chip-clear");
      if (!clear) return;
      clear.addEventListener("click", () => {
        const field = chip.dataset.sessionChip;
        if (field === "user") sessionsFilter.user = "";
        else if (field === "asset") sessionsFilter.asset = "";
        else if (field === "status") { sessionsFilter.status = ""; sessionsFilter.onlyActive = false; }
        loadSessions().then(renderSessionsView);
      });
    });
    const chipReset = pane.querySelector(".filter-chips .filter-chip-reset");
    if (chipReset) chipReset.addEventListener("click", () => {
      sessionsFilter.user = "";
      sessionsFilter.asset = "";
      sessionsFilter.status = "";
      sessionsFilter.onlyActive = false;
      loadSessions().then(renderSessionsView);
    });
  }

  // Sidebar on the Sessions page — lists connectable assets grouped by env/vpc/bastion.
  async function loadSidebarAssets() {
    if (!hasPermission("cmdb.asset:read")) {
      state.sidebarAssets = [];
      renderSessionsSidebar();
      return;
    }
    try {
      const data = await api("/api/v1/cmdb/assets?limit=500&offset=0");
      state.sidebarAssets = (data.items || []).filter(isConnectableAsset);
    } catch (_) {
      state.sidebarAssets = [];
    }
    renderSessionsSidebar();
  }

  function renderSessionsSidebar() {
    const tree = $("sessions-sidebar-tree");
    if (!tree) return;
    const all = state.sidebarAssets || [];
    if (all.length === 0) {
      tree.innerHTML = '<div class="tree-empty">No connectable assets.</div>';
      return;
    }
    const needle = String(state.sidebarSearch || "").toLowerCase().trim();
    const matches = needle
      ? all.filter((a) => {
          const hay = [a.name, a.id, a.type, a.env, a.public_ip, a.private_ip, a.private_dns, a.vpc_id]
            .filter(Boolean).join(" ").toLowerCase();
          return hay.includes(needle);
        })
      : all;
    if (matches.length === 0) {
      tree.innerHTML = '<div class="tree-empty">No matches.</div>';
      return;
    }
    const envs = new Map();
    matches.forEach((asset) => {
      const envKey = asset.env || "default";
      if (!envs.has(envKey)) envs.set(envKey, new Map());
      const vpcs = envs.get(envKey);
      const vpcKey = asset.vpc_id || "__no_vpc__";
      if (!vpcs.has(vpcKey)) vpcs.set(vpcKey, { bastions: [], members: [] });
      const bucket = vpcs.get(vpcKey);
      if (asset.is_vpc_proxy) bucket.bastions.push(asset);
      else bucket.members.push(asset);
    });
    const parts = [];
    [...envs.keys()].sort().forEach((envName) => {
      const vpcs = envs.get(envName);
      let total = 0;
      vpcs.forEach((b) => { total += b.bastions.length + b.members.length; });
      parts.push('<details class="sidebar-env" open><summary>env · ' + safe(envName) +
        ' <span class="count">(' + total + ')</span></summary>');
      const vpcKeys = [...vpcs.keys()].sort((a, b) => {
        if (a === "__no_vpc__") return 1;
        if (b === "__no_vpc__") return -1;
        return a.localeCompare(b);
      });
      vpcKeys.forEach((vpcID) => {
        const { bastions, members } = vpcs.get(vpcID);
        const vpcLabel = vpcID === "__no_vpc__" ? "No VPC" : vpcID;
        const count = bastions.length + members.length;
        parts.push('<details class="sidebar-vpc" open><summary>vpc · <code>' + safe(vpcLabel) +
          '</code> <span class="count">(' + count + ')</span></summary>' +
          '<div class="sidebar-members">');
        [...bastions, ...members].forEach((a) => parts.push(renderSidebarAsset(a)));
        parts.push('</div></details>');
      });
      parts.push('</details>');
    });
    tree.innerHTML = parts.join("");
  }

  function renderSidebarAsset(asset) {
    const addr = asset.public_ip || asset.private_ip || asset.private_dns || "";
    const badge = asset.is_vpc_proxy ? '<span class="pill success tiny">bastion</span>' : '';
    return '<div class="sidebar-asset" data-sidebar-asset="' + safe(asset.id) +
      '" title="' + safe(asset.name + (addr ? " · " + addr : "")) + '">' +
      badge +
      '<span class="asset-name">' + safe(asset.name || asset.id) + '</span>' +
      (addr ? '<span class="asset-addr">' + safe(addr) + '</span>' : '') +
    '</div>';
  }

  function bindSessionsSidebarEvents() {
    const tree = $("sessions-sidebar-tree");
    if (tree) {
      tree.addEventListener("click", (e) => {
        const row = e.target.closest("[data-sidebar-asset]");
        if (!row) return;
        connectAssetFromList(row.dataset.sidebarAsset);
      });
    }
    const search = $("sessions-sidebar-search");
    if (search) {
      let t;
      search.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.sidebarSearch = search.value;
          renderSessionsSidebar();
        }, 120);
      });
    }
    const refresh = $("sessions-sidebar-refresh");
    if (refresh) refresh.addEventListener("click", loadSidebarAssets);
    bindSessionsRailControls();
  }

  // bindSessionsRailControls wires the collapse toggle and the drag-to-resize
  // handle on the asset rail (Redesign Phase 3 §7.4). Width and collapsed
  // state are persisted in localStorage so each operator's preferred layout
  // survives reloads.
  function bindSessionsRailControls() {
    const sidebar = $("sessions-sidebar");
    const collapseBtn = $("sessions-sidebar-collapse");
    const resizer = $("sessions-sidebar-resizer");
    if (!sidebar) return;

    // Restore previously saved layout.
    let storedCollapsed = false;
    let storedWidth = 0;
    try {
      storedCollapsed = localStorage.getItem("ops_platform_sessions_rail_collapsed") === "1";
      storedWidth = parseInt(localStorage.getItem("ops_platform_sessions_rail_width") || "0", 10) || 0;
    } catch (_) {}
    applyRailCollapsed(sidebar, storedCollapsed);
    if (storedWidth >= 200 && storedWidth <= 600) applyRailWidth(sidebar, storedWidth);

    if (collapseBtn && !collapseBtn.dataset.bound) {
      collapseBtn.dataset.bound = "1";
      collapseBtn.addEventListener("click", () => {
        const next = !sidebar.classList.contains("collapsed");
        applyRailCollapsed(sidebar, next);
        try { localStorage.setItem("ops_platform_sessions_rail_collapsed", next ? "1" : "0"); } catch (_) {}
      });
    }

    if (resizer && !resizer.dataset.bound) {
      resizer.dataset.bound = "1";
      let startX = 0;
      let startWidth = 0;
      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const next = Math.max(200, Math.min(600, startWidth + dx));
        applyRailWidth(sidebar, next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try { localStorage.setItem("ops_platform_sessions_rail_width", String(sidebar.offsetWidth)); } catch (_) {}
      };
      resizer.addEventListener("mousedown", (ev) => {
        if (sidebar.classList.contains("collapsed")) return;
        ev.preventDefault();
        startX = ev.clientX;
        startWidth = sidebar.offsetWidth;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    }
  }

  function applyRailCollapsed(sidebar, collapsed) {
    sidebar.classList.toggle("collapsed", !!collapsed);
    const btn = $("sessions-sidebar-collapse");
    if (btn) {
      btn.textContent = collapsed ? "›" : "‹";
      btn.title = collapsed ? "Expand rail" : "Collapse rail";
      btn.setAttribute("aria-label", btn.title);
    }
  }

  function applyRailWidth(sidebar, px) {
    sidebar.style.flex = "0 0 " + px + "px";
    sidebar.style.width = px + "px";
  }

  // applySessionsLayout reflects the section's subsection (live vs audit)
  // onto the layout: audit hides the rail entirely, since the rail only
  // exists to launch new sessions.
  function applySessionsLayout(subsection) {
    const layout = $("sessions-layout");
    if (!layout) return;
    layout.classList.toggle("audit-mode", subsection === "audit");
  }
  // ===== Sessions end =====


  // ===== Renderers =====

  function renderStats() {
    elements.metricAssets.textContent = String(state.assetTotal || state.assets.length);
    elements.metricAccounts.textContent = String(state.awsAccounts.length);
    elements.metricRoles.textContent = String(state.roles.length);
    elements.metricWrite.textContent = writeAccess() ? "Yes" : "No";
  }

  function renderProfile() {
    if (!state.user) {
      elements.userBadge.textContent = "Guest";
      elements.userRoleText.textContent = "Not signed in";
      elements.userAvatar.textContent = "?";
      elements.identityOutput.innerHTML = '<div class="timeline-empty">No session.</div>';
      elements.permissionChips.innerHTML = '<div class="timeline-empty">No permissions.</div>';
      return;
    }

    const name = state.user.name || state.user.email || state.user.oidc_subject || "User";
    elements.userBadge.textContent = name;
    elements.userRoleText.textContent = state.roles.join(", ") || "no roles";
    elements.userAvatar.textContent = initials(name);

    elements.identityOutput.innerHTML =
      '<div class="identity-card">' +
      '<div class="avatar">' + safe(initials(name)) + '</div>' +
      '<div class="identity-meta">' +
      '<div class="name">' + safe(name) + '</div>' +
      (state.user.email ? '<div class="sub">' + safe(state.user.email) + '</div>' : '') +
      '<div class="sub">' + safe(state.user.oidc_subject || "") + '</div>' +
      '</div></div>' +
      '<div class="summary-grid" style="margin-top: 16px;">' +
      '<div class="summary-cell"><div class="label">Roles</div><div class="value">' + state.roles.length + '</div></div>' +
      '<div class="summary-cell"><div class="label">Permissions</div><div class="value">' + state.permissions.length + '</div></div>' +
      '<div class="summary-cell"><div class="label">Last login</div><div class="value">' + safe(formatRelative(state.user.last_login_at)) + '</div></div>' +
      '</div>';

    renderPermissionChips();
  }

  function renderPermissionChips() {
    if (!state.user) return;
    if (state.permissions.length === 0 && state.roles.length === 0) {
      elements.permissionChips.innerHTML = '<div class="timeline-empty">No permissions.</div>';
      return;
    }

    const groups = { __roles: [] };
    state.roles.forEach((r) => groups.__roles.push(r));
    state.permissions.forEach((perm) => {
      const [resource, action] = perm.split(":");
      const key = resource || "other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(action || perm);
    });

    let html = '';
    html += '<div class="perm-group"><div class="perm-group-name">Roles</div><div class="chips">';
    html += groups.__roles.map((r) => '<span class="chip accent">' + safe(r) + '</span>').join("");
    html += '</div></div>';

    Object.keys(groups).sort().forEach((key) => {
      if (key === "__roles") return;
      html += '<div class="perm-group"><div class="perm-group-name">' + safe(key) + '</div><div class="chips">';
      html += groups[key].map((a) => '<span class="chip">' + safe(a) + '</span>').join("");
      html += '</div></div>';
    });

    elements.permissionChips.innerHTML = html;
  }

  function statusPill(status) {
    const s = String(status || "").toLowerCase();
    if (["active", "running", "available", "success", "ok"].includes(s)) {
      return '<span class="pill success"><span class="dot"></span>' + safe(s) + '</span>';
    }
    if (["pending", "stopping", "in_progress", "warn"].includes(s)) {
      return '<span class="pill warn"><span class="dot"></span>' + safe(s) + '</span>';
    }
    if (["failed", "terminated", "stopped", "error"].includes(s)) {
      return '<span class="pill danger"><span class="dot"></span>' + safe(s) + '</span>';
    }
    return '<span class="pill neutral"><span class="dot"></span>' + safe(s || "unknown") + '</span>';
  }

  function sourcePill(source) {
    const s = String(source || "manual").toLowerCase();
    if (s === "aws") return '<span class="pill accent">AWS</span>';
    return '<span class="pill neutral">' + safe(s) + '</span>';
  }

  // Asset types that represent network/metadata objects with no interactive session.
  // Everything else (ec2_instance, rds_instance, manual hosts, etc.) is treated as
  // potentially connectable so the Connect path stays available.
  const NON_CONNECTABLE_TYPES = new Set([
    "aws_vpc", "vpc",
    "aws_subnet", "subnet",
    "aws_security_group", "security_group",
    "aws_route_table", "route_table",
    "aws_internet_gateway", "internet_gateway",
    "aws_nat_gateway", "nat_gateway",
    "aws_ebs_volume", "ebs_volume",
    "aws_elb", "elb", "alb", "nlb",
    "aws_s3_bucket", "s3_bucket",
    "aws_iam_role", "iam_role",
    "aws_iam_user", "iam_user",
    "aws_account", "aws_region",
  ]);
  function isConnectableAsset(asset) {
    if (!asset) return false;
    const t = String(asset.type || "").toLowerCase();
    return !NON_CONNECTABLE_TYPES.has(t);
  }

  function renderHealth() {
    const items = [
      {
        label: "API server",
        hint: "ops-api /healthz",
        ok: state.health.api === true,
        unknown: state.health.api === null,
      },
      {
        label: "Database",
        hint: "PostgreSQL connection",
        ok: state.health.db === true,
        unknown: state.health.db === null,
      },
    ];

    elements.healthList.innerHTML = items
      .map((item) => {
        const pill = item.unknown
          ? '<span class="pill neutral"><span class="dot"></span>unknown</span>'
          : item.ok
          ? '<span class="pill success"><span class="dot"></span>healthy</span>'
          : '<span class="pill danger"><span class="dot"></span>down</span>';
        return (
          '<li class="status-row">' +
          '<div class="status-label">' + safe(item.label) + '<span class="sub">' + safe(item.hint) + '</span></div>' +
          pill +
          '</li>'
        );
      })
      .join("");
  }

  function renderActivity() {
    if (state.activity.length === 0) {
      elements.activityList.innerHTML = '<li class="timeline-empty">No activity yet.</li>';
      return;
    }
    elements.activityList.innerHTML = state.activity
      .map((entry) => {
        const time = entry.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const badge =
          entry.kind === "error"
            ? '<span class="pill danger"><span class="dot"></span>err</span>'
            : entry.kind === "success"
            ? '<span class="pill success"><span class="dot"></span>ok</span>'
            : '';
        return (
          '<li class="timeline-item">' +
          '<div class="timeline-time">' + safe(time) + '</div>' +
          '<div class="timeline-msg">' + badge + safe(entry.message) + '</div>' +
          '</li>'
        );
      })
      .join("");
  }

  function criticalityPill(value) {
    if (!value) return '<span class="muted">—</span>';
    const v = String(value).toLowerCase();
    const kind = v === "critical" || v === "high" ? "danger" : v === "medium" ? "warn" : "neutral";
    return '<span class="pill ' + kind + '">' + safe(v) + '</span>';
  }

  function renderAssetTable() {
    applyAssetViewMode();
    renderAssetFilterChips();
    if (state.assetViewMode === "tree") {
      renderAssetTree();
      renderAssetHint();
      return;
    }
    const cols = 9;
    if (!hasPermission("cmdb.asset:read")) {
      elements.assetsTableBody.innerHTML =
        '<tr class="empty-row"><td colspan="' + cols + '">Permission required: cmdb.asset:read</td></tr>';
      elements.assetsCountHint.textContent = "";
      elements.assetsPagination.innerHTML = "";
      return;
    }

    if (state.assets.length === 0) {
      elements.assetsTableBody.innerHTML =
        '<tr class="empty-row"><td colspan="' + cols + '">' +
        (isFilterActive() ? "No matches for the current filters." : "No assets yet.") +
        '</td></tr>';
    } else {
      elements.assetsTableBody.innerHTML = state.assets
        .map((asset) => {
          const network = [
            asset.public_ip ? '<code>' + safe(asset.public_ip) + '</code>' : null,
            asset.private_ip ? '<code class="muted">' + safe(asset.private_ip) + '</code>' : null,
          ]
            .filter(Boolean)
            .join('<br/>') || '<span class="muted">—</span>';
          const region = asset.region
            ? '<code>' + safe(asset.region) + '</code>' +
              (asset.zone ? '<div class="muted">' + safe(asset.zone) + '</div>' : '')
            : '<span class="muted">—</span>';
          const proxyTag = asset.is_vpc_proxy
            ? ' <span class="pill success" style="margin-left:6px;vertical-align:middle">VPC proxy</span>'
            : '';
          return (
            '<tr data-asset-id="' + safe(asset.id) + '">' +
            '<td><div class="primary">' + safe(asset.name) + proxyTag + '</div>' +
            (asset.private_dns ? '<div class="muted">' + safe(asset.private_dns) + '</div>' : '') +
            '</td>' +
            "<td>" + safe(asset.type) + "</td>" +
            "<td>" + safe(asset.env || "default") + "</td>" +
            "<td>" + statusPill(asset.status) + "</td>" +
            "<td>" + (asset.owner ? safe(asset.owner) : '<span class="muted">—</span>') + "</td>" +
            "<td>" + region + "</td>" +
            "<td>" + network + "</td>" +
            "<td>" + sourcePill(asset.source) + "</td>" +
            '<td class="row-actions-cell">' +
            (isConnectableAsset(asset)
              ? '<button class="btn ghost small" data-connect-asset="' + safe(asset.id) + '" title="Open terminal">Connect</button>'
              : '<span class="muted" title="' + safe(asset.type) + ' assets are metadata only">—</span>') +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
    }

    renderAssetHint();
    renderAssetPagination();
  }

  function renderAssetHint() {
    const { limit, offset } = state.assetQuery;
    const total = state.assetTotal;
    if (total === 0) {
      elements.assetsCountHint.textContent = "0 assets";
      return;
    }
    const from = offset + 1;
    const to = Math.min(offset + state.assets.length, total);
    elements.assetsCountHint.textContent = from + "–" + to + " of " + total;
  }

  function renderAssetPagination() {
    if (state.assetViewMode === "tree") {
      elements.assetsPagination.innerHTML = "";
      return;
    }
    const total = state.assetTotal;
    const { limit, offset } = state.assetQuery;
    if (total <= limit) {
      elements.assetsPagination.innerHTML = "";
      return;
    }
    const prevDisabled = offset <= 0 ? "disabled" : "";
    const nextDisabled = offset + limit >= total ? "disabled" : "";
    elements.assetsPagination.innerHTML =
      '<div>Page size ' + limit + '</div>' +
      '<div class="pager">' +
      '<button type="button" data-page="prev" ' + prevDisabled + '>Prev</button>' +
      '<button type="button" data-page="next" ' + nextDisabled + '>Next</button>' +
      '</div>';
  }

  function applyAssetViewMode() {
    const mode = state.assetViewMode === "tree" ? "tree" : "list";
    if (elements.assetsListWrap) {
      elements.assetsListWrap.hidden = mode === "tree";
    }
    if (elements.assetsTree) {
      elements.assetsTree.hidden = mode !== "tree";
    }
    if (elements.assetsViewToggle) {
      elements.assetsViewToggle.querySelectorAll(".view-toggle-btn").forEach((btn) => {
        const active = btn.dataset.viewMode === mode;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });
    }
    if (mode === "tree") {
      elements.assetsPagination.innerHTML = "";
    }
  }

  function renderAssetTree() {
    const tree = elements.assetsTree;
    if (!tree) return;
    if (!hasPermission("cmdb.asset:read")) {
      tree.innerHTML = '<div class="tree-empty">Permission required: cmdb.asset:read</div>';
      return;
    }
    if (state.assets.length === 0) {
      tree.innerHTML = '<div class="tree-empty">' +
        (isFilterActive() ? "No matches for the current filters." : "No assets yet.") +
        '</div>';
      return;
    }

    // Group by env → vpc_id → bastion (is_vpc_proxy) vs members.
    const envs = new Map();
    state.assets.forEach((asset) => {
      const envKey = asset.env || "default";
      if (!envs.has(envKey)) envs.set(envKey, new Map());
      const vpcs = envs.get(envKey);
      const vpcKey = asset.vpc_id || "__no_vpc__";
      if (!vpcs.has(vpcKey)) vpcs.set(vpcKey, { bastions: [], members: [] });
      const bucket = vpcs.get(vpcKey);
      if (asset.is_vpc_proxy) bucket.bastions.push(asset);
      else bucket.members.push(asset);
    });

    const envNames = [...envs.keys()].sort();
    const isOpen = (key, defaultOpen) => {
      const v = state.treeExpanded[key];
      return v === undefined ? defaultOpen : !!v;
    };

    const parts = [];
    envNames.forEach((envName) => {
      const vpcs = envs.get(envName);
      const envKey = "env:" + envName;
      let envCount = 0;
      vpcs.forEach((b) => { envCount += b.bastions.length + b.members.length; });
      const vpcKeys = [...vpcs.keys()].sort((a, b) => {
        if (a === "__no_vpc__") return 1;
        if (b === "__no_vpc__") return -1;
        return a.localeCompare(b);
      });
      parts.push(
        '<details class="tree-env" data-tree-key="' + safe(envKey) + '"' +
        (isOpen(envKey, true) ? ' open' : '') + '>' +
        '<summary><span class="chev">▶</span>env · ' + safe(envName) +
        ' <span class="count">(' + envCount + ')</span></summary>'
      );
      vpcKeys.forEach((vpcID) => {
        const { bastions, members } = vpcs.get(vpcID);
        const vpcLabel = vpcID === "__no_vpc__" ? "No VPC" : vpcID;
        const vpcKey = envKey + "|vpc:" + vpcID;
        const total = bastions.length + members.length;
        parts.push(
          '<details class="tree-vpc" data-tree-key="' + safe(vpcKey) + '"' +
          (isOpen(vpcKey, true) ? ' open' : '') + '>' +
          '<summary><span class="chev">▶</span>vpc · <code>' + safe(vpcLabel) + '</code>' +
          ' <span class="count">(' + total + ')</span></summary>'
        );
        bastions.forEach((bastion, idx) => {
          const bastionKey = vpcKey + "|bastion:" + bastion.id;
          // Only the first bastion lists the VPC members as peers so each
          // member appears once even if multiple bastions share a VPC.
          const peers = idx === 0 ? members : [];
          parts.push(
            '<details class="tree-bastion" data-tree-key="' + safe(bastionKey) + '"' +
            (isOpen(bastionKey, true) ? ' open' : '') + '>' +
            '<summary><span class="chev">▶</span>' +
            '<span class="pill success tiny">bastion</span> ' +
            renderTreeNodeInline(bastion) +
            ' <span class="count">(' + peers.length + ' peer' + (peers.length === 1 ? '' : 's') + ')</span>' +
            '</summary>' +
            '<div class="tree-members peer-members">' +
            (peers.length === 0
              ? '<div class="tree-empty">No peer assets in this VPC.</div>'
              : peers.map((m) => renderTreeNode(m)).join("")) +
            '</div>' +
            '</details>'
          );
        });
        if (bastions.length === 0 && members.length > 0) {
          parts.push(
            '<div class="tree-members">' +
            members.map((m) => renderTreeNode(m)).join("") +
            '</div>'
          );
        }
        parts.push('</details>');
      });
      parts.push('</details>');
    });

    tree.innerHTML = parts.join("");
  }

  function renderTreeNodeInline(asset) {
    const addr = asset.public_ip || asset.private_ip || "";
    return (
      '<span class="tree-node" data-asset-id="' + safe(asset.id) + '" role="button">' +
      '<span class="name">' + safe(asset.name) + '</span>' +
      (addr ? '<code>' + safe(addr) + '</code>' : '') +
      '<span class="muted">' + safe(asset.type || "") + '</span>' +
      (asset.status ? statusPill(asset.status) : '') +
      '</span>'
    );
  }

  function renderTreeNode(asset) {
    const addr = asset.public_ip || asset.private_ip || "";
    return (
      '<div class="tree-node" data-asset-id="' + safe(asset.id) + '" role="button" tabindex="0">' +
      '<span class="name">' + safe(asset.name) + '</span>' +
      (addr ? '<code>' + safe(addr) + '</code>' : '') +
      '<span class="muted">' + safe(asset.type || "") + '</span>' +
      (asset.status ? statusPill(asset.status) : '') +
      (asset.owner ? '<span class="muted">' + safe(asset.owner) + '</span>' : '') +
      '</div>'
    );
  }

  function isFilterActive() {
    const q = state.assetQuery;
    return !!(q.env || q.type || q.status || q.source || q.region || q.criticality || q.q || q.includeBastions);
  }

  // ASSET_FILTER_CHIPS drives the chip strip above the inventory table. Each
  // entry is [field, label, formatter]; formatter receives the raw query
  // value and returns the display string (so booleans like includeBastions
  // can show as "Including bastions").
  const ASSET_FILTER_CHIPS = [
    ["q",          "search",      (v) => v],
    ["env",        "env",         (v) => v],
    ["type",       "type",        (v) => v],
    ["status",     "status",      (v) => v],
    ["source",     "source",      (v) => v],
    ["region",     "region",      (v) => v],
    ["criticality","criticality", (v) => v],
    ["includeBastions", "scope",  (v) => v ? "incl. bastions" : null],
  ];

  function renderAssetFilterChips() {
    const host = document.getElementById("assets-filter-chips");
    if (!host) return;
    const q = state.assetQuery;
    const chips = [];
    ASSET_FILTER_CHIPS.forEach(([field, label, fmt]) => {
      const raw = q[field];
      if (raw === undefined || raw === null || raw === "" || raw === false) return;
      const display = fmt(raw);
      if (!display) return;
      chips.push(
        '<span class="filter-chip" data-chip-field="' + safe(field) + '">' +
          '<span class="filter-chip-key">' + safe(label) + ':</span>' +
          '<span class="filter-chip-value">' + safe(display) + '</span>' +
          '<button type="button" class="filter-chip-clear" aria-label="Clear ' + safe(label) + '" title="Clear ' + safe(label) + '">×</button>' +
        '</span>'
      );
    });
    if (chips.length === 0) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = chips.join("") +
      '<button type="button" class="filter-chip-reset">Clear all</button>';
    host.querySelectorAll(".filter-chip").forEach((node) => {
      const clearBtn = node.querySelector(".filter-chip-clear");
      if (!clearBtn) return;
      clearBtn.addEventListener("click", () => clearAssetFilter(node.dataset.chipField));
    });
    const resetBtn = host.querySelector(".filter-chip-reset");
    if (resetBtn) resetBtn.addEventListener("click", clearAllAssetFilters);
  }

  function clearAssetFilter(field) {
    if (!field) return;
    if (field === "includeBastions") {
      state.assetQuery.includeBastions = false;
    } else {
      state.assetQuery[field] = "";
    }
    state.assetQuery.offset = 0;
    // Sync the matching toolbar control.
    const inputs = {
      q: elements.assetSearch,
      env: $("filter-env"),
      type: $("filter-type"),
      status: $("filter-status"),
      source: $("filter-source"),
      region: $("filter-region"),
    };
    if (inputs[field]) inputs[field].value = "";
    if (field === "includeBastions") {
      const btn = $("filter-include-bastions");
      if (btn) btn.dataset.on = "0";
    }
    refreshAssets();
  }

  function clearAllAssetFilters() {
    state.assetQuery = {
      env: "", type: "", status: "", source: "", region: "", criticality: "",
      q: "", limit: state.assetQuery.limit, offset: 0, includeBastions: false,
    };
    if (elements.assetSearch) elements.assetSearch.value = "";
    ["filter-env","filter-type","filter-status","filter-source","filter-region","filter-criticality"].forEach((id) => {
      const el = $(id); if (el) el.value = "";
    });
    const btn = $("filter-include-bastions");
    if (btn) btn.dataset.on = "0";
    refreshAssets();
  }

  function populateFilterSelect(el, values, currentValue) {
    const placeholder = el.options[0] ? el.options[0].outerHTML : "";
    const opts = values
      .filter(Boolean)
      .map((v) => {
        const sel = v === currentValue ? " selected" : "";
        return '<option value="' + safe(v) + '"' + sel + '>' + safe(v) + '</option>';
      })
      .join("");
    el.innerHTML = placeholder + opts;
    el.value = currentValue || "";
  }

  async function refreshFilterOptions() {
    const q = state.assetQuery;
    let facets = { envs: [], types: [], statuses: [], sources: [], regions: [] };
    try {
      facets = await api("/api/v1/cmdb/assets/facets");
    } catch (_error) {
      // Fall back to building from current page if facets endpoint unavailable.
      state.assets.forEach((a) => {
        if (a.env) facets.envs.push(a.env);
        if (a.type) facets.types.push(a.type);
        if (a.status) facets.statuses.push(a.status);
        if (a.source) facets.sources.push(a.source);
        if (a.region) facets.regions.push(a.region);
      });
    }
    // Preserve current selection if the facet list is missing it.
    const merge = (list, selected) => {
      const set = new Set(list);
      if (selected) set.add(selected);
      return [...set].sort();
    };
    populateFilterSelect(elements.filterEnv, merge(facets.envs, q.env), q.env);
    populateFilterSelect(elements.filterType, merge(facets.types, q.type), q.type);
    populateFilterSelect(elements.filterStatus, merge(facets.statuses, q.status), q.status);
    populateFilterSelect(elements.filterSource, merge(facets.sources, q.source), q.source);
    populateFilterSelect(elements.filterRegion, merge(facets.regions, q.region), q.region);
  }

  // ===== Asset detail drawer =====

  async function openAssetDrawer(assetID) {
    if (!assetID) return;
    state.assetDrawer.open = true;
    state.assetDrawer.busy = "";
    elements.assetDrawer.setAttribute("aria-hidden", "false");
    elements.assetDrawerTitle.textContent = "Loading...";
    elements.assetDrawerSub.textContent = "";
    elements.assetDrawerEyebrow.textContent = "Asset";
    elements.assetDrawerBody.innerHTML =
      '<div class="muted" style="padding:20px 0">Loading...</div>';
    try {
      const asset = await api("/api/v1/cmdb/assets/" + encodeURIComponent(assetID));
      state.assetDrawer.asset = asset;
      state.assetDrawer.labels = Object.entries(asset.labels || {}).map(([k, v]) => ({
        k,
        v: typeof v === "string" ? v : JSON.stringify(v),
      }));
      await Promise.all([
        loadAssetConnection(assetID),
        loadAssetProbe(assetID),
        loadAssetRelations(assetID),
        loadSSHProxies(),
        loadHostKeys(),
        loadKeypairs(),
      ]);
      renderAssetDrawer();
    } catch (error) {
      elements.assetDrawerBody.innerHTML =
        '<div class="pill danger">Load failed: ' + safe(error.message) + '</div>';
    }
  }

  async function loadAssetConnection(assetID) {
    try {
      const conn = await api("/api/v1/cmdb/assets/" + encodeURIComponent(assetID) + "/connection");
      state.assetDrawer.connection = conn;
      state.assetDrawer.connEdit = connectionToEdit(conn);
    } catch (error) {
      // 404 is the "no profile yet" case — surface blank editor instead of erroring
      state.assetDrawer.connection = null;
      state.assetDrawer.connEdit = connectionToEdit(null);
    }
  }

  async function loadAssetProbe(assetID) {
    if (!hasPermission("cmdb.asset:read")) {
      state.assetDrawer.probe = null;
      return;
    }
    try {
      state.assetDrawer.probe = await api(
        "/api/v1/cmdb/assets/" + encodeURIComponent(assetID) + "/probe/latest"
      );
    } catch (error) {
      state.assetDrawer.probe = null;
    }
  }

  async function loadAssetRelations(assetID) {
    try {
      state.assetDrawer.relations = await api(
        "/api/v1/cmdb/assets/" + encodeURIComponent(assetID) + "/relations"
      );
    } catch (error) {
      state.assetDrawer.relations = [];
    }
  }

  async function loadSSHProxies() {
    if (!hasPermission("cmdb.asset:read")) {
      state.sshProxies = [];
      return;
    }
    try {
      const resp = await api("/api/v1/cmdb/ssh-proxies");
      state.sshProxies = (resp && resp.items) || [];
    } catch (error) {
      state.sshProxies = [];
    }
  }

  function emptyProxyForm() {
    return {
      id: "",
      name: "",
      description: "",
      network_zone: "",
      host: "",
      port: 22,
      username: "",
      auth_type: "password",
      password: "",
      private_key: "",
      passphrase: "",
    };
  }

  function startProxyCreate() {
    state.proxyForm = emptyProxyForm();
    renderProxiesView();
  }

  function startProxyEdit(id) {
    const existing = (state.sshProxies || []).find((p) => p.id === id);
    if (!existing) return;
    state.proxyForm = Object.assign(emptyProxyForm(), {
      id: existing.id,
      name: existing.name,
      description: existing.description || "",
      network_zone: existing.network_zone || "",
      host: existing.host,
      port: existing.port || 22,
      username: existing.username,
      auth_type: existing.auth_type || "password",
      has_password: !!existing.has_password,
      has_private_key: !!existing.has_private_key,
      has_passphrase: !!existing.has_passphrase,
    });
    renderProxiesView();
  }

  function cancelProxyForm() {
    state.proxyForm = null;
    renderProxiesView();
  }

  async function saveProxyForm() {
    const f = state.proxyForm;
    if (!f) return;
    const body = {
      name: (f.name || "").trim(),
      description: f.description || "",
      network_zone: (f.network_zone || "").trim(),
      host: (f.host || "").trim(),
      port: Number(f.port) || 22,
      username: (f.username || "").trim(),
      auth_type: f.auth_type || "password",
    };
    if (f.auth_type === "password" && f.password) body.password = f.password;
    if (f.auth_type === "key") {
      if (f.private_key) body.private_key = f.private_key;
      if (f.passphrase) body.passphrase = f.passphrase;
    }
    state.proxyFormBusy = true;
    renderProxiesView();
    try {
      if (f.id) {
        await api("/api/v1/cmdb/ssh-proxies/" + encodeURIComponent(f.id), {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast("Proxy updated", "success");
      } else {
        await api("/api/v1/cmdb/ssh-proxies", { method: "POST", body: JSON.stringify(body) });
        toast("Proxy created", "success");
      }
      state.proxyForm = null;
      await loadSSHProxies();
    } catch (error) {
      toast("Save failed: " + error.message, "error");
    } finally {
      state.proxyFormBusy = false;
      renderProxiesView();
    }
  }

  async function deleteProxyFromList(id) {
    if (!confirm("Delete this proxy? Assets using it will lose proxy binding.")) return;
    try {
      await api("/api/v1/cmdb/ssh-proxies/" + encodeURIComponent(id), { method: "DELETE" });
      toast("Proxy deleted", "success");
      await loadSSHProxies();
      renderProxiesView();
    } catch (error) {
      toast("Delete failed: " + error.message, "error");
    }
  }

  function renderProxiesView() {
    const panel = $("view-proxies");
    if (!panel) return;
    const canWrite = hasPermission("cmdb.asset:write");
    const list = state.sshProxies || [];
    const rows = list.length
      ? list.map((p) =>
          '<tr>' +
          '<td><strong>' + safe(p.name) + '</strong>' + (p.description ? '<div class="muted" style="font-size:12px">' + safe(p.description) + '</div>' : '') + '</td>' +
          '<td>' + safe(p.network_zone || "-") + '</td>' +
          '<td><code>' + safe(p.host) + ':' + safe(p.port) + '</code></td>' +
          '<td>' + safe(p.username) + '</td>' +
          '<td>' + safe(p.auth_type) + '</td>' +
          '<td style="text-align:right">' +
          (canWrite
            ? '<button class="btn ghost" data-proxy-edit="' + safe(p.id) + '">Edit</button> ' +
              '<button class="btn ghost" data-proxy-delete="' + safe(p.id) + '">Delete</button>'
            : '') +
          '</td>' +
          '</tr>'
        ).join("")
      : '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No SSH proxies yet.</td></tr>';

    const table =
      '<section class="panel">' +
      '<div class="panel-head">' +
      '<div><h2>SSH proxies</h2><div class="panel-hint">Jump hosts per network zone.</div></div>' +
      (canWrite ? '<button class="btn primary" id="proxy-new-btn">+ New proxy</button>' : '') +
      '</div>' +
      '<div class="panel-body flush"><div class="table-wrap"><table>' +
      '<thead><tr><th>Name</th><th>Zone</th><th>Endpoint</th><th>Username</th><th>Auth</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div></section>';

    const form = state.proxyForm ? renderProxyForm() : '';
    panel.innerHTML =
      '<div class="page-header"><div><h1>SSH proxies</h1><p class="subtitle">Reach assets in isolated network zones via chained SSH jumps.</p></div></div>' +
      form + table;

    bindProxiesViewEvents();
  }

  function renderProxyForm() {
    const f = state.proxyForm;
    const busy = state.proxyFormBusy;
    const isEdit = !!f.id;
    const pwPlaceholder = f.has_password ? "(unchanged)" : "enter password";
    const keyPlaceholder = f.has_private_key ? "(unchanged)" : "-----BEGIN OPENSSH PRIVATE KEY-----";
    const phPlaceholder = f.has_passphrase ? "(unchanged)" : "(optional)";
    const authFields = f.auth_type === "key"
      ? '<div class="field full"><label>Private key (PEM)</label><textarea data-proxy="private_key" rows="4" placeholder="' + keyPlaceholder + '">' + safe(f.private_key) + '</textarea></div>' +
        '<div class="field"><label>Passphrase</label><input type="password" data-proxy="passphrase" value="' + safe(f.passphrase) + '" placeholder="' + phPlaceholder + '" /></div>'
      : '<div class="field"><label>Password</label><input type="password" data-proxy="password" value="' + safe(f.password) + '" placeholder="' + pwPlaceholder + '" /></div>';

    return '<section class="panel" id="proxy-form-panel">' +
      '<div class="panel-head"><div><h2>' + (isEdit ? "Edit proxy" : "New proxy") + '</h2></div></div>' +
      '<div class="panel-body"><div class="form-grid">' +
      '<div class="field"><label>Name</label><input data-proxy="name" value="' + safe(f.name) + '" /></div>' +
      '<div class="field"><label>Network zone</label><input data-proxy="network_zone" value="' + safe(f.network_zone) + '" placeholder="zone-a" /></div>' +
      '<div class="field"><label>Host</label><input data-proxy="host" value="' + safe(f.host) + '" /></div>' +
      '<div class="field"><label>Port</label><input data-proxy="port" type="number" value="' + safe(f.port) + '" /></div>' +
      '<div class="field"><label>Username</label><input data-proxy="username" value="' + safe(f.username) + '" /></div>' +
      '<div class="field"><label>Auth type</label><select data-proxy="auth_type">' +
      '<option value="password"' + (f.auth_type === "password" ? " selected" : "") + '>password</option>' +
      '<option value="key"' + (f.auth_type === "key" ? " selected" : "") + '>key</option>' +
      '</select></div>' +
      '<div class="field full"><label>Description</label><input data-proxy="description" value="' + safe(f.description) + '" /></div>' +
      authFields +
      '</div><div class="form-actions">' +
      '<button type="button" class="btn ghost" id="proxy-cancel-btn" ' + (busy ? "disabled" : "") + '>Cancel</button>' +
      '<button type="button" class="btn primary" id="proxy-save-btn" ' + (busy ? "disabled" : "") + '>' + (busy ? "Saving..." : "Save") + '</button>' +
      '</div></div></section>';
  }

  function bindProxiesViewEvents() {
    const panel = $("view-proxies");
    if (!panel) return;
    const newBtn = $("proxy-new-btn");
    if (newBtn) newBtn.addEventListener("click", startProxyCreate);
    panel.querySelectorAll("[data-proxy-edit]").forEach((btn) => {
      btn.addEventListener("click", () => startProxyEdit(btn.getAttribute("data-proxy-edit")));
    });
    panel.querySelectorAll("[data-proxy-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteProxyFromList(btn.getAttribute("data-proxy-delete")));
    });
    const formPanel = $("proxy-form-panel");
    if (!formPanel) return;
    formPanel.addEventListener("input", (event) => {
      const field = event.target.dataset.proxy;
      if (!field || !state.proxyForm) return;
      state.proxyForm[field] = field === "port" ? (Number(event.target.value) || 0) : event.target.value;
    });
    formPanel.addEventListener("change", (event) => {
      if (event.target.dataset.proxy === "auth_type") {
        state.proxyForm.auth_type = event.target.value;
        renderProxiesView();
      }
    });
    const saveBtn = $("proxy-save-btn");
    if (saveBtn) saveBtn.addEventListener("click", saveProxyForm);
    const cancelBtn = $("proxy-cancel-btn");
    if (cancelBtn) cancelBtn.addEventListener("click", cancelProxyForm);
  }

  function connectionToEdit(conn) {
    const protocol = conn ? conn.protocol || "ssh" : "ssh";
    return {
      protocol,
      host: conn ? conn.host || "" : "",
      port: conn ? conn.port || (protocol === "postgres" ? 5432 : 22) : (protocol === "postgres" ? 5432 : 22),
      username: conn ? conn.username || "" : "",
      auth_type: conn ? conn.auth_type || "password" : "password",
      database: conn ? conn.database || "" : "",
      proxy_id: conn ? conn.proxy_id || "" : "",
      bastion_enabled: conn ? !!conn.bastion_enabled : true,
      password: "",
      private_key: "",
      passphrase: "",
    };
  }

  function closeAssetDrawer() {
    state.assetDrawer.open = false;
    state.assetDrawer.asset = null;
    state.assetDrawer.labels = [];
    state.assetDrawer.connection = null;
    state.assetDrawer.probe = null;
    state.assetDrawer.relations = [];
    state.assetDrawer.connEdit = null;
    state.assetDrawer.busy = "";
    elements.assetDrawer.setAttribute("aria-hidden", "true");
  }

  function renderAssetDrawer() {
    const asset = state.assetDrawer.asset;
    if (!asset) return;
    elements.assetDrawerEyebrow.textContent = (asset.type || "asset") + " · " + (asset.source || "manual");
    elements.assetDrawerTitle.textContent = asset.name || asset.id;
    const proxyBadge = asset.is_vpc_proxy
      ? ' <span class="pill success" title="This asset is the designated SSH bastion for its VPC">VPC proxy</span>'
      : '';
    elements.assetDrawerSub.innerHTML =
      (asset.external_id ? '<code>' + safe(asset.external_id) + '</code>' : '<span class="muted">—</span>') +
      proxyBadge;

    const identity = kvList([
      ["Status", statusPill(asset.status)],
      ["Criticality", criticalityPill(asset.criticality)],
      ["Environment", safe(asset.env || "default")],
      ["Source", sourcePill(asset.source)],
      ["Created", safe(formatDate(asset.created_at))],
      ["Updated", safe(formatDate(asset.updated_at))],
      ["Expires", asset.expires_at ? safe(formatDate(asset.expires_at)) : '<span class="muted">—</span>'],
    ]);

    const osImageCell = asset.os_image
      ? '<code>' + safe(asset.os_image) + '</code>' +
        (asset.ami_name ? '<div class="muted">' + safe(asset.ami_name) + '</div>' : '') +
        (asset.os_family ? '<div class="muted">family: ' + safe(asset.os_family) + '</div>' : '')
      : dash();
    const infra = kvList([
      ["Region", asset.region ? '<code>' + safe(asset.region) + '</code>' : dash()],
      ["Zone", asset.zone ? '<code>' + safe(asset.zone) + '</code>' : dash()],
      ["Account", asset.account_id ? '<code>' + safe(asset.account_id) + '</code>' : dash()],
      ["Instance type", asset.instance_type ? '<code>' + safe(asset.instance_type) + '</code>' : dash()],
      ["OS image", osImageCell],
      ["VPC", asset.vpc_id ? '<code>' + safe(asset.vpc_id) + '</code>' : dash()],
      ["Subnet", asset.subnet_id ? '<code>' + safe(asset.subnet_id) + '</code>' : dash()],
    ]);

    const network = kvList([
      ["Public IP", asset.public_ip ? '<code>' + safe(asset.public_ip) + '</code>' : dash()],
      ["Private IP", asset.private_ip ? '<code>' + safe(asset.private_ip) + '</code>' : dash()],
      ["Private DNS", asset.private_dns ? '<code>' + safe(asset.private_dns) + '</code>' : dash()],
    ]);

    const business = kvList([
      ["Owner", asset.owner ? safe(asset.owner) : dash()],
      ["Business unit", asset.business_unit ? safe(asset.business_unit) : dash()],
    ]);

    const systemTags = asset.system_tags || {};
    const sysRows = Object.keys(systemTags)
      .sort()
      .map((k) => {
        const v = systemTags[k];
        const display = typeof v === "string" ? v : JSON.stringify(v);
        return '<tr><td>' + safe(k) + '</td><td><code>' + safe(display) + '</code></td></tr>';
      })
      .join("");
    const systemSection = sysRows
      ? '<table class="tag-table"><tbody>' + sysRows + '</tbody></table>'
      : '<div class="muted">No system tags.</div>';

    const canWrite = hasPermission("cmdb.asset:write");
    const labelsEditor = canWrite ? renderLabelsEditor() : renderLabelsReadOnly();

    const connectable = isConnectableAsset(asset);
    const proxySection = connectable && asset.type === "aws_ec2_instance"
      ? section("VPC SSH proxy role", renderVPCProxySection())
      : "";

    // Drawer tabs (Phase 2): five named panes over the same data the drawer
    // already loaded. The previous layout stacked all sections vertically;
    // splitting them keeps the drawer scannable on tall assets and matches
    // the redesign doc §7.2 split (Summary / Connection / Probe / Relations /
    // Metadata).
    const tabs = [
      { id: "summary",  label: "Summary",  enabled: true },
      { id: "connection", label: "Connection", enabled: connectable },
      { id: "probe",    label: "Probe",    enabled: connectable },
      { id: "relations", label: "Relations", enabled: true },
      { id: "metadata", label: "Metadata", enabled: true },
    ];
    const enabledTabs = tabs.filter((t) => t.enabled);
    let activeTab = state.assetDrawer.tab || "summary";
    if (!enabledTabs.find((t) => t.id === activeTab)) activeTab = enabledTabs[0].id;
    state.assetDrawer.tab = activeTab;

    const tabStrip =
      '<div class="drawer-tabs" role="tablist">' +
      enabledTabs.map((t) => (
        '<button class="drawer-tab' + (t.id === activeTab ? " active" : "") +
        '" data-drawer-tab="' + t.id + '" role="tab" aria-selected="' + (t.id === activeTab) + '">' +
        safe(t.label) + "</button>"
      )).join("") +
      "</div>";

    const labelsFooter = canWrite
      ? '<div class="drawer-footer">' +
          '<button type="button" class="btn ghost" id="drawer-cancel-btn">Reset</button>' +
          '<button type="button" class="btn primary" id="drawer-save-btn">Save labels</button>' +
        '</div>'
      : '';

    const summaryPane =
      section("Identity", identity) +
      section("Infrastructure", infra) +
      section("Network", network) +
      section("Ownership", business);
    const connectionPane = connectable
      ? section("Bastion connection", renderConnectionSection()) + proxySection
      : '<div class="muted" style="padding:12px">Connection editor is only available for connectable assets.</div>';
    const probePane = connectable
      ? section("Last probe", renderProbeSection())
      : '<div class="muted" style="padding:12px">Probe history is only available for connectable assets.</div>';
    const relationsPane = section("Relations", renderRelationsSection());
    const metadataPane =
      section("System tags", systemSection + '<div class="muted" style="margin-top:6px;font-size:12px">Managed by sync. Read-only.</div>') +
      section("Labels", labelsEditor + labelsFooter);

    const paneFor = {
      summary: summaryPane,
      connection: connectionPane,
      probe: probePane,
      relations: relationsPane,
      metadata: metadataPane,
    };

    elements.assetDrawerBody.innerHTML = tabStrip +
      enabledTabs.map((t) => (
        '<div class="drawer-tab-pane" data-drawer-pane="' + t.id + '"' +
        (t.id === activeTab ? '' : ' hidden') + '>' + paneFor[t.id] + '</div>'
      )).join("");

    // Tab switching: hide all panes, show the chosen one. We don't re-render
    // the whole drawer because forms (connection editor, label drafts) carry
    // unsaved local state we'd lose.
    elements.assetDrawerBody.querySelectorAll(".drawer-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.drawerTab;
        state.assetDrawer.tab = target;
        elements.assetDrawerBody.querySelectorAll(".drawer-tab").forEach((b) => {
          const on = b.dataset.drawerTab === target;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", on);
        });
        elements.assetDrawerBody.querySelectorAll(".drawer-tab-pane").forEach((p) => {
          p.hidden = p.dataset.drawerPane !== target;
        });
      });
    });

    if (canWrite) bindLabelsEditorEvents();
    if (connectable) {
      bindConnectionSectionEvents();
      bindVPCProxyEvents();
    }
    bindRelationEvents();

    elements.assetDrawerBody.querySelectorAll("[data-hostkey-action]").forEach((btn) => {
      btn.addEventListener("click", () => onAssetHostKeyAction(btn.dataset.hostkeyAction));
    });
    elements.assetDrawerBody.querySelectorAll("[data-nav]").forEach((link) => {
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        closeAssetDrawer();
        setView(link.dataset.nav);
      });
    });
  }

  function renderRelationsSection() {
    const rels = state.assetDrawer.relations || [];
    const asset = state.assetDrawer.asset;
    const assetID = asset ? asset.id : "";
    if (rels.length === 0) return '<div class="muted">No relations.</div>';
    const graph = renderRelationMiniGraph(rels, asset);
    const rows = rels.map((rel) => {
      const isFrom = rel.from_asset_id === assetID;
      const peerName = isFrom ? (rel.to_name || rel.to_asset_id) : (rel.from_name || rel.from_asset_id);
      const peerType = isFrom ? rel.to_type : rel.from_type;
      const peerID = isFrom ? rel.to_asset_id : rel.from_asset_id;
      const arrow = isFrom ? "→" : "←";
      const canWrite = hasPermission("cmdb.asset:write");
      return (
        '<div class="relation-row">' +
        '<span class="pill">' + safe(rel.relation_type) + '</span> ' +
        '<span class="muted">' + arrow + '</span> ' +
        '<a href="#" class="relation-link" data-open-asset="' + safe(peerID) + '">' + safe(peerName) + '</a>' +
        (peerType ? ' <span class="muted">(' + safe(peerType) + ')</span>' : '') +
        ' <span class="pill ghost">' + safe(rel.source) + '</span>' +
        (canWrite && rel.source === "manual"
          ? ' <button class="btn ghost small" data-delete-relation="' + safe(rel.id) + '" data-asset-id="' + safe(assetID) + '">Remove</button>'
          : '') +
        '</div>'
      );
    }).join("");
    return graph + rows;
  }

  function renderRelationMiniGraph(rels, asset) {
    if (!asset || !rels || rels.length === 0) return "";
    const assetID = asset.id;
    // Group edges by peer so a neighbor with multiple relations shows once.
    const peers = new Map();
    rels.forEach((rel) => {
      const isFrom = rel.from_asset_id === assetID;
      const peerID = isFrom ? rel.to_asset_id : rel.from_asset_id;
      if (!peerID) return;
      const peerName = isFrom ? (rel.to_name || rel.to_asset_id) : (rel.from_name || rel.from_asset_id);
      const peerType = isFrom ? (rel.to_type || "") : (rel.from_type || "");
      if (!peers.has(peerID)) {
        peers.set(peerID, { id: peerID, name: peerName, type: peerType, types: new Set(), out: false, in: false });
      }
      const p = peers.get(peerID);
      p.types.add(rel.relation_type || "related");
      if (isFrom) p.out = true; else p.in = true;
    });

    const peerList = [...peers.values()];
    const n = peerList.length;
    const W = 360;
    const H = Math.max(200, Math.min(360, 160 + n * 14));
    const cx = W / 2;
    const cy = H / 2;
    const cR = 28;
    const pR = 20;
    const radius = Math.min(W, H) / 2 - pR - 28;

    const truncate = (s, max) => {
      const str = String(s || "");
      return str.length > max ? str.slice(0, max - 1) + "…" : str;
    };

    const pieces = [];
    pieces.push(
      '<svg class="relation-svg" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Asset relation graph">' +
      '<defs>' +
      '<marker id="rel-arrow-out" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/></marker>' +
      '<marker id="rel-arrow-in" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M0,0 L10,5 L0,10 z" fill="var(--text-muted)"/></marker>' +
      '</defs>'
    );

    peerList.forEach((p, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
      const px = cx + radius * Math.cos(angle);
      const py = cy + radius * Math.sin(angle);
      // Shorten edge endpoints so arrowheads don't hide inside nodes.
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      const x1 = cx + ux * cR;
      const y1 = cy + uy * cR;
      const x2 = px - ux * pR;
      const y2 = py - uy * pR;
      const marker = p.out && !p.in
        ? ' marker-end="url(#rel-arrow-out)"'
        : (!p.out && p.in
            ? ' marker-start="url(#rel-arrow-in)"'
            : ' marker-end="url(#rel-arrow-out)" marker-start="url(#rel-arrow-in)"');
      const edgeClass = p.out && p.in ? "edge both" : (p.out ? "edge out" : "edge in");
      pieces.push(
        '<line class="' + edgeClass + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) +
        '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"' + marker + '/>'
      );
      const label = [...p.types].join(", ");
      const lx = (x1 + x2) / 2;
      const ly = (y1 + y2) / 2 - 4;
      pieces.push(
        '<text class="edge-label" x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle">' +
        safe(truncate(label, 22)) + '</text>'
      );
      pieces.push(
        '<g class="peer-group" data-open-asset="' + safe(p.id) + '" tabindex="0" role="button" aria-label="Open ' + safe(p.name) + '">' +
        '<circle class="node peer" cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + pR + '"/>' +
        '<text class="node-label" x="' + px.toFixed(1) + '" y="' + (py + 4).toFixed(1) + '" text-anchor="middle">' +
        safe(truncate(p.name, 10)) + '</text>' +
        '<title>' + safe(p.name) + (p.type ? " (" + safe(p.type) + ")" : "") + '</title>' +
        '</g>'
      );
    });

    // Center node last so it overlays edges.
    pieces.push(
      '<g class="center-group">' +
      '<circle class="node center" cx="' + cx + '" cy="' + cy + '" r="' + cR + '"/>' +
      '<text class="node-label center-label" x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle">' +
      safe(truncate(asset.name || "", 12)) + '</text>' +
      '<title>' + safe(asset.name || "") + '</title>' +
      '</g>'
    );

    pieces.push('</svg>');
    return '<div class="relation-graph">' + pieces.join("") + '</div>';
  }

  function bindRelationEvents() {
    elements.assetDrawerBody.querySelectorAll("[data-open-asset]").forEach((link) => {
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        openAssetDrawer(link.dataset.openAsset);
      });
      link.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        openAssetDrawer(link.dataset.openAsset);
      });
    });
    elements.assetDrawerBody.querySelectorAll("[data-delete-relation]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const relID = btn.dataset.deleteRelation;
        const assetID = btn.dataset.assetId;
        try {
          await api("/api/v1/cmdb/assets/" + encodeURIComponent(assetID) + "/relations/" + encodeURIComponent(relID), { method: "DELETE" });
          toast("Relation removed.", "ok");
          await loadAssetRelations(assetID);
          renderAssetDrawer();
        } catch (error) {
          toast("Remove failed: " + error.message, "error");
        }
      });
    });
  }

  function renderAssetHostKeyRow() {
    const asset = state.assetDrawer.asset;
    if (!asset) return "";
    const record = (state.hostkeys || []).find((k) => k.scope === "asset" && k.target_id === asset.id);
    const canWrite = hasPermission("cmdb.asset:write");
    if (!record) {
      return '<div class="hostkey-inline muted">No pinned host key yet · will TOFU-record on first connect.</div>';
    }
    const pending = record.status === "override_pending";
    const mismatch = !pending && record.last_mismatch_at;
    const badge = pending
      ? '<span class="badge warning">override pending</span>'
      : (mismatch ? '<span class="badge error">mismatch ' + safe(relativeTime(record.last_mismatch_at)) + '</span>'
                  : '<span class="badge success">pinned</span>');
    const actions = canWrite
      ? (pending
          ? '<button class="btn ghost" data-hostkey-action="cancel">Cancel override</button>'
          : '<button class="btn ghost" data-hostkey-action="override">Approve override</button> ' +
            '<button class="btn ghost danger" data-hostkey-action="forget">Forget</button>')
      : '';
    return '<div class="hostkey-inline">' +
      '<div class="hostkey-inline-head">' + badge +
      '<span class="muted">last seen ' + safe(relativeTime(record.last_seen_at)) + '</span></div>' +
      '<div class="hostkey-inline-fp"><code>' + safe(record.fingerprint_sha256) + '</code>' +
      ' <button class="icon-btn" data-hostkey-action="copy" title="Copy fingerprint">' +
        '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>' +
      '</button></div>' +
      (mismatch ? '<div class="sub muted">offered <code>' + safe(record.last_mismatch_fingerprint) + '</code></div>' : '') +
      (pending ? '<div class="sub muted">approved by ' + safe(record.override_by || "admin") + ' · expires ' + safe(relativeTime(record.override_expires_at)) + '</div>' : '') +
      (actions ? '<div class="hostkey-inline-actions">' + actions + '</div>' : '') +
      '</div>';
  }

  async function onAssetHostKeyAction(action) {
    const asset = state.assetDrawer.asset;
    if (!asset) return;
    const record = (state.hostkeys || []).find((k) => k.scope === "asset" && k.target_id === asset.id);
    if (action === "copy") {
      if (record) copyToClipboard(record.fingerprint_sha256);
      return;
    }
    try {
      if (action === "override") {
        if (!confirm("Approve one-time override for " + asset.name + "?\nNext connection will replace the pinned fingerprint.")) return;
        await api("/api/v1/cmdb/hostkeys/asset/" + encodeURIComponent(asset.id) + "/override", { method: "POST", body: "{}" });
        toast("Override approved · 10 min window", "success");
      } else if (action === "forget" || action === "cancel") {
        const prompt = action === "cancel"
          ? "Cancel pending override? The old pin will be deleted; next connect re-TOFUs."
          : "Forget pinned host key? Next connect TOFUs fresh.";
        if (!confirm(prompt)) return;
        await api("/api/v1/cmdb/hostkeys/asset/" + encodeURIComponent(asset.id), { method: "DELETE" });
        toast(action === "cancel" ? "Override cancelled" : "Host key forgotten", "success");
      }
      await loadHostKeys();
      renderAssetDrawer();
    } catch (err) {
      toast("Host key action failed: " + err.message, "error");
    }
  }

  function renderConnectionSection() {
    const conn = state.assetDrawer.connection;
    const edit = state.assetDrawer.connEdit || connectionToEdit(null);
    const canWrite = hasPermission("cmdb.asset:write");
    const busy = state.assetDrawer.busy;

    const probePillHTML = (() => {
      if (!conn || !conn.last_probe_status) {
        return '<span class="pill neutral">never tested</span>';
      }
      if (conn.last_probe_status === "success") {
        return '<span class="pill success"><span class="dot"></span>' +
          safe(formatRelative(conn.last_probe_at)) + '</span>';
      }
      return '<span class="pill danger"><span class="dot"></span>failed</span>';
    })();

    const errorRow = conn && conn.last_probe_error
      ? '<div class="muted" style="font-size:12px;margin-top:6px;word-break:break-word">' + safe(conn.last_probe_error) + '</div>'
      : '';

    const asset = state.assetDrawer.asset;
    const keyName = asset && asset.key_name ? String(asset.key_name) : "";
    const matched = keyName && (state.keypairs || []).some((k) => k.name === keyName);
    const keyHint = keyName
      ? '<div class="muted" style="font-size:12px;margin-top:6px;padding:8px;border-radius:8px;background:var(--surface);border:1px solid var(--border)">' +
        '<strong>EC2 KeyPair:</strong> <code>' + safe(keyName) + '</code> — ' +
        (matched
          ? '<span style="color:var(--success, #4ade80)">matching .pem uploaded; SSH will use it automatically.</span>'
          : 'upload a <code>.pem</code> with this name in <a href="#" data-nav="keypairs">SSH keypairs</a> to enable SSH without per-asset credentials.') +
        '</div>'
      : '';

    const statusHeader =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
      '<div>' + probePillHTML + '</div>' +
      (conn && conn.last_probe_at
        ? '<div class="muted" style="font-size:12px">' + safe(formatDate(conn.last_probe_at)) + '</div>'
        : '') +
      '</div>' + errorRow + keyHint + renderAssetHostKeyRow();

    if (!canWrite && !conn) {
      return statusHeader + '<div class="muted">No connection profile.</div>';
    }

    const passwordField =
      '<div class="field"><label>Password</label>' +
      '<input type="password" data-conn="password" value="' + safe(edit.password) + '" placeholder="' +
      (conn && conn.has_password ? "(unchanged)" : "enter password") + '" ' + (canWrite ? '' : 'disabled') + ' /></div>';

    const keyField =
      '<div class="field full"><label>Private key (PEM)</label>' +
      '<textarea data-conn="private_key" rows="4" placeholder="' +
      (conn && conn.has_private_key ? "(unchanged)" : "-----BEGIN OPENSSH PRIVATE KEY-----") +
      '" ' + (canWrite ? '' : 'disabled') + '>' + safe(edit.private_key) + '</textarea></div>' +
      '<div class="field"><label>Passphrase</label>' +
      '<input type="password" data-conn="passphrase" value="' + safe(edit.passphrase) + '" placeholder="' +
      (conn && conn.has_passphrase ? "(unchanged)" : "(optional)") + '" ' + (canWrite ? '' : 'disabled') + ' /></div>';

    const isPg = edit.protocol === "postgres";
    const isRdp = edit.protocol === "rdp";
    const authFields = (!isPg && !isRdp && edit.auth_type === "key") ? keyField : passwordField;

    const proxies = state.sshProxies || [];
    const proxyOptions = ['<option value="">(direct, no proxy)</option>']
      .concat(proxies.map((p) =>
        '<option value="' + safe(p.id) + '"' + (edit.proxy_id === p.id ? " selected" : "") + '>' +
        safe(p.name) + (p.network_zone ? " — " + safe(p.network_zone) : "") + '</option>'
      ))
      .join("");

    const protocolSelect =
      '<div class="field"><label>Protocol</label>' +
      '<select data-conn="protocol" ' + (canWrite ? '' : 'disabled') + '>' +
      '<option value="ssh"' + (edit.protocol === "ssh" ? " selected" : "") + '>ssh</option>' +
      '<option value="postgres"' + (edit.protocol === "postgres" ? " selected" : "") + '>postgres</option>' +
      '<option value="rdp"' + (edit.protocol === "rdp" ? " selected" : "") + '>rdp</option>' +
      '</select></div>';

    const databaseField = isPg
      ? '<div class="field"><label>Database</label><input data-conn="database" value="' + safe(edit.database) + '" placeholder="postgres" ' + (canWrite ? '' : 'disabled') + ' /></div>'
      : '';

    const authTypeField = (isPg || isRdp)
      ? ''
      : '<div class="field"><label>Auth type</label>' +
        '<select data-conn="auth_type" ' + (canWrite ? '' : 'disabled') + '>' +
        '<option value="password"' + (edit.auth_type === "password" ? " selected" : "") + '>password</option>' +
        '<option value="key"' + (edit.auth_type === "key" ? " selected" : "") + '>key</option>' +
        '</select></div>';

    const form =
      '<div class="conn-form">' +
      '<div class="form-grid">' +
      protocolSelect +
      '<div class="field"><label>Host</label><input data-conn="host" value="' + safe(edit.host) + '" ' + (canWrite ? '' : 'disabled') + ' /></div>' +
      '<div class="field"><label>Port</label><input data-conn="port" type="number" value="' + safe(edit.port) + '" ' + (canWrite ? '' : 'disabled') + ' /></div>' +
      '<div class="field"><label>Username</label><input data-conn="username" value="' + safe(edit.username) + '" ' + (canWrite ? '' : 'disabled') + ' /></div>' +
      authTypeField +
      databaseField +
      '<div class="field"><label>SSH proxy</label>' +
      '<select data-conn="proxy_id" ' + (canWrite ? '' : 'disabled') + '>' + proxyOptions + '</select></div>' +
      '<div class="field"><label>Bastion enabled</label>' +
      '<label class="checkbox-inline"><input type="checkbox" data-conn="bastion_enabled" ' +
      (edit.bastion_enabled ? "checked" : "") + " " + (canWrite ? '' : 'disabled') +
      ' /> <span class="muted">auto-probe this asset</span></label></div>' +
      authFields +
      '</div>' +
      (canWrite
        ? '<div class="drawer-footer">' +
          '<button type="button" class="btn ghost" id="conn-test-btn" ' + (busy ? "disabled" : "") + '>' +
          (busy === "test" ? "Testing..." : "Test connection") + '</button>' +
          '<button type="button" class="btn ghost" id="conn-probe-btn" ' + (busy ? "disabled" : "") + '>' +
          (busy === "probe" ? "Probing..." : "Probe now") + '</button>' +
          (edit.protocol === "ssh" || edit.protocol === "" || !edit.protocol
            ? '<button type="button" class="btn ghost" id="conn-terminal-btn" ' + (busy ? "disabled" : "") + '>Open terminal</button>'
            : '') +
          (edit.protocol === "rdp"
            ? '<button type="button" class="btn ghost" id="conn-rdp-btn" ' + (busy ? "disabled" : "") + '>Open RDP</button>'
            : '') +
          '<button type="button" class="btn primary" id="conn-save-btn" ' + (busy ? "disabled" : "") + '>Save</button>' +
          '</div>'
        : '') +
      '</div>';

    return statusHeader + form;
  }

  function renderProbeSection() {
    const probe = state.assetDrawer.probe;
    if (!probe) {
      return '<div class="muted">No probe snapshot yet. Save a connection and click "Probe now".</div>';
    }
    const rows = kvList([
      ["Collected", safe(formatDate(probe.collected_at)) + ' <span class="muted">by ' + safe(probe.collected_by) + '</span>'],
      ["OS", safe(probe.os_name || "-") + (probe.os_version ? ' <span class="muted">' + safe(probe.os_version) + '</span>' : "")],
      ["Kernel / Arch", safe(probe.kernel || "-") + ' / ' + safe(probe.arch || "-")],
      ["Hostname", probe.hostname ? '<code>' + safe(probe.hostname) + '</code>' : dash()],
      ["CPU", (probe.cpu_cores ? safe(probe.cpu_cores) + " cores" : "-") + (probe.cpu_model ? ' <span class="muted">' + safe(probe.cpu_model) + '</span>' : "")],
      ["Memory", probe.memory_mb ? safe(probe.memory_mb) + " MB" : dash()],
      ["Uptime", probe.uptime_seconds ? safe(formatUptime(probe.uptime_seconds)) : dash()],
    ]);
    const disk = probe.disk_summary
      ? '<pre class="code-block">' + safe(probe.disk_summary) + '</pre>'
      : '';
    return rows + disk;
  }

  function renderVPCProxySection() {
    const asset = state.assetDrawer.asset;
    if (!asset) return "";
    const canWrite = hasPermission("cmdb.asset:write");
    const busy = state.assetDrawer.busy === "promote" || state.assetDrawer.busy === "demote";

    const summary = asset.is_vpc_proxy
      ? '<div class="muted" style="margin-bottom:10px">This asset is the designated SSH bastion for VPC <code>' +
        safe(asset.vpc_id || "-") + '</code>. Other EC2 assets in the same VPC route through it using their private IPs.</div>'
      : '<div class="muted" style="margin-bottom:10px">Promote this asset to serve as the SSH bastion for VPC <code>' +
        safe(asset.vpc_id || "-") + '</code>. Peer assets with <code>auto_managed</code> connections will be repointed automatically.</div>';

    const blockers = [];
    if (!asset.public_ip) blockers.push("missing public_ip");
    if (!asset.vpc_id) blockers.push("missing vpc_id");
    const blockerHint = (!asset.is_vpc_proxy && blockers.length > 0)
      ? '<div class="muted" style="color:var(--danger, #f87171);margin-bottom:8px">Cannot promote: ' + safe(blockers.join(", ")) + '.</div>'
      : '';

    if (!canWrite) {
      return summary + '<div class="muted">Permission required: cmdb.asset:write</div>';
    }

    const inferredUsername = asset.is_vpc_proxy
      ? ""
      : (defaultUsernameForOSFamily(asset.os_family) || "");
    const edit = state.assetDrawer.vpcProxyEdit || { username: inferredUsername, auth_type: asset.key_name ? "key" : "password" };
    state.assetDrawer.vpcProxyEdit = edit;

    const form = asset.is_vpc_proxy
      ? ('<button type="button" class="btn ghost" id="vpc-proxy-demote-btn"' + (busy ? " disabled" : "") + '>' +
         (state.assetDrawer.busy === "demote" ? "Demoting..." : "Demote (stop acting as VPC proxy)") + '</button>')
      : ('<div class="form-grid">' +
         '<div class="field"><label>SSH username</label>' +
         '<input data-vpc-proxy="username" value="' + safe(edit.username) + '" placeholder="' +
         safe(inferredUsername || "ec2-user / ubuntu / ...") + '" /></div>' +
         '<div class="field"><label>Auth type</label>' +
         '<select data-vpc-proxy="auth_type">' +
         '<option value="key"' + (edit.auth_type === "key" ? " selected" : "") + '>key</option>' +
         '<option value="password"' + (edit.auth_type === "password" ? " selected" : "") + '>password</option>' +
         '</select></div>' +
         '</div>' +
         blockerHint +
         '<div class="drawer-footer">' +
         '<button type="button" class="btn primary" id="vpc-proxy-promote-btn"' +
         ((busy || blockers.length > 0) ? " disabled" : "") + '>' +
         (state.assetDrawer.busy === "promote" ? "Promoting..." : "Promote as VPC proxy") + '</button>' +
         '</div>');

    return summary + form;
  }

  function defaultUsernameForOSFamily(family) {
    switch ((family || "").toLowerCase()) {
      case "amzn":
      case "rhel":
      case "suse":
        return "ec2-user";
      case "ubuntu":
        return "ubuntu";
      case "debian":
        return "admin";
      case "centos":
        return "centos";
      case "windows":
        return "Administrator";
      default:
        return "";
    }
  }

  function bindVPCProxyEvents() {
    const root = elements.assetDrawerBody;
    if (!root) return;
    root.querySelectorAll('[data-vpc-proxy]').forEach((el) => {
      el.addEventListener("input", (ev) => {
        const field = ev.target.dataset.vpcProxy;
        state.assetDrawer.vpcProxyEdit[field] = ev.target.value;
      });
      el.addEventListener("change", (ev) => {
        const field = ev.target.dataset.vpcProxy;
        state.assetDrawer.vpcProxyEdit[field] = ev.target.value;
      });
    });
    const promoteBtn = $("vpc-proxy-promote-btn");
    if (promoteBtn) promoteBtn.addEventListener("click", promoteVPCProxy);
    const demoteBtn = $("vpc-proxy-demote-btn");
    if (demoteBtn) demoteBtn.addEventListener("click", demoteVPCProxy);
  }

  async function promoteVPCProxy() {
    const asset = state.assetDrawer.asset;
    if (!asset) return;
    const edit = state.assetDrawer.vpcProxyEdit || {};
    state.assetDrawer.busy = "promote";
    renderAssetDrawer();
    try {
      const resp = await api("/api/v1/cmdb/assets/" + encodeURIComponent(asset.id) + "/promote-vpc-proxy", {
        method: "POST",
        body: JSON.stringify({ username: (edit.username || "").trim(), auth_type: edit.auth_type || "" }),
      });
      state.assetDrawer.asset = resp.asset || asset;
      state.assetDrawer.vpcProxyEdit = null;
      toast("Promoted to VPC proxy", "success");
      logActivity("Promoted " + (asset.name || asset.id) + " as VPC proxy", "success");
      await Promise.all([
        loadAssetConnection(asset.id),
        loadSSHProxies(),
        refreshAssets(),
      ]);
    } catch (error) {
      toast("Promote failed: " + error.message, "error");
    } finally {
      state.assetDrawer.busy = "";
      renderAssetDrawer();
    }
  }

  async function demoteVPCProxy() {
    const asset = state.assetDrawer.asset;
    if (!asset) return;
    if (!confirm("Demote " + (asset.name || asset.id) + " as VPC proxy?\nPeer assets with auto-managed connections will have proxy_id cleared.")) {
      return;
    }
    state.assetDrawer.busy = "demote";
    renderAssetDrawer();
    try {
      await api("/api/v1/cmdb/assets/" + encodeURIComponent(asset.id) + "/demote-vpc-proxy", {
        method: "POST",
        body: "{}",
      });
      const refreshed = await api("/api/v1/cmdb/assets/" + encodeURIComponent(asset.id));
      state.assetDrawer.asset = refreshed;
      state.assetDrawer.vpcProxyEdit = null;
      toast("Demoted", "success");
      logActivity("Demoted " + (asset.name || asset.id) + " as VPC proxy", "info");
      await Promise.all([
        loadAssetConnection(asset.id),
        loadSSHProxies(),
        refreshAssets(),
      ]);
    } catch (error) {
      toast("Demote failed: " + error.message, "error");
    } finally {
      state.assetDrawer.busy = "";
      renderAssetDrawer();
    }
  }

  function formatUptime(seconds) {
    const s = Number(seconds) || 0;
    if (s <= 0) return "-";
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d) parts.push(d + "d");
    if (h || d) parts.push(h + "h");
    parts.push(m + "m");
    return parts.join(" ");
  }

  function bindConnectionSectionEvents() {
    const root = elements.assetDrawerBody.querySelector(".conn-form");
    if (!root) return;

    root.addEventListener("input", (event) => {
      const field = event.target.dataset.conn;
      if (!field) return;
      const edit = state.assetDrawer.connEdit;
      if (event.target.type === "checkbox") {
        edit[field] = event.target.checked;
      } else if (field === "port") {
        edit[field] = Number(event.target.value) || 0;
      } else {
        edit[field] = event.target.value;
      }
    });
    root.addEventListener("change", (event) => {
      const field = event.target.dataset.conn;
      if (field === "auth_type") {
        state.assetDrawer.connEdit.auth_type = event.target.value;
        renderAssetDrawer();
      } else if (field === "protocol") {
        const edit = state.assetDrawer.connEdit;
        edit.protocol = event.target.value;
        if (edit.protocol === "postgres") {
          edit.auth_type = "password";
          if (!edit.port || edit.port === 22) edit.port = 5432;
          if (!edit.database) edit.database = "postgres";
        } else if (edit.port === 5432) {
          edit.port = 22;
        }
        renderAssetDrawer();
      } else if (field === "proxy_id") {
        state.assetDrawer.connEdit.proxy_id = event.target.value;
      }
    });

    const saveBtn = $("conn-save-btn");
    if (saveBtn) saveBtn.addEventListener("click", saveConnection);
    const testBtn = $("conn-test-btn");
    if (testBtn) testBtn.addEventListener("click", testConnection);
    const probeBtn = $("conn-probe-btn");
    if (probeBtn) probeBtn.addEventListener("click", runProbeNow);
    const terminalBtn = $("conn-terminal-btn");
    if (terminalBtn) terminalBtn.addEventListener("click", openTerminalForCurrentAsset);
    const rdpBtn = $("conn-rdp-btn");
    if (rdpBtn) rdpBtn.addEventListener("click", openRDPForCurrentAsset);
  }

  async function saveConnection() {
    const asset = state.assetDrawer.asset;
    const edit = state.assetDrawer.connEdit;
    if (!asset || !edit) return;
    const protocol = edit.protocol || "ssh";
    const defaultPort = protocol === "postgres" ? 5432 : (protocol === "rdp" ? 3389 : 22);
    const body = {
      protocol,
      host: (edit.host || "").trim(),
      port: Number(edit.port) || defaultPort,
      username: (edit.username || "").trim(),
      auth_type: (protocol === "postgres" || protocol === "rdp") ? "password" : (edit.auth_type || "password"),
      bastion_enabled: !!edit.bastion_enabled,
      proxy_id: edit.proxy_id || "",
    };
    if (protocol === "postgres") {
      body.database = (edit.database || "").trim();
    }
    if (body.auth_type === "password" && edit.password !== "") {
      body.password = edit.password;
    }
    if (body.auth_type === "key") {
      if (edit.private_key !== "") body.private_key = edit.private_key;
      if (edit.passphrase !== "") body.passphrase = edit.passphrase;
    }
    state.assetDrawer.busy = "save";
    renderAssetDrawer();
    try {
      const conn = await api("/api/v1/cmdb/assets/" + encodeURIComponent(asset.id) + "/connection", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      state.assetDrawer.connection = conn;
      state.assetDrawer.connEdit = connectionToEdit(conn);
      toast("Connection saved", "success");
      logActivity("Connection saved for " + (asset.name || asset.id), "success");
    } catch (error) {
      toast("Save failed: " + error.message, "error");
    } finally {
      state.assetDrawer.busy = "";
      renderAssetDrawer();
    }
  }

  async function testConnection() {
    const asset = state.assetDrawer.asset;
    if (!asset) return;
    state.assetDrawer.busy = "test";
    renderAssetDrawer();
    try {
      await api("/api/v1/cmdb/assets/" + encodeURIComponent(asset.id) + "/connection/test", { method: "POST", body: "{}" });
      toast("Connection OK", "success");
      logActivity("Connection test OK for " + (asset.name || asset.id), "success");
    } catch (error) {
      toast("Test failed: " + error.message, "error");
    } finally {
      await loadAssetConnection(asset.id);
      state.assetDrawer.busy = "";
      renderAssetDrawer();
    }
  }

  async function runProbeNow() {
    const asset = state.assetDrawer.asset;
    if (!asset) return;
    state.assetDrawer.busy = "probe";
    renderAssetDrawer();
    try {
      await api("/api/v1/cmdb/assets/" + encodeURIComponent(asset.id) + "/probe/run", { method: "POST", body: "{}" });
      toast("Probe complete", "success");
      logActivity("Probe completed for " + (asset.name || asset.id), "success");
    } catch (error) {
      toast("Probe failed: " + error.message, "error");
    } finally {
      await loadAssetConnection(asset.id);
      await loadAssetProbe(asset.id);
      state.assetDrawer.busy = "";
      renderAssetDrawer();
    }
  }

  // ===== Sessions page: live-session manager =====
  const liveSessions = [];
  let nextLiveId = 1;
  let activeSessionID = null;

  function liveTabsEl() { return $("sessions-live-tabs"); }
  function liveToolbarEl() { return $("sessions-live-toolbar"); }
  function liveBodyEl() { return $("sessions-live-body"); }
  function liveEmptyEl() { return $("sessions-live-empty"); }

  function createLiveSession(opts) {
    const id = "ls" + (nextLiveId++);
    const asset = opts.asset || {};
    const sess = {
      id,
      kind: opts.kind,
      asset: { id: asset.id, name: asset.name, type: asset.type, env: asset.env },
      status: "idle",
      mount: null,
      ws: null, term: null, fit: null, onResize: null,
      client: null, tunnel: null, keyboard: null, mouse: null,
    };
    const body = liveBodyEl();
    if (!body) return sess;
    const mount = document.createElement("div");
    mount.className = "session-mount kind-" + sess.kind;
    mount.dataset.sessionId = id;
    mount.tabIndex = 0;
    body.appendChild(mount);
    sess.mount = mount;
    liveSessions.push(sess);
    setView("sessions");
    setSessionsPane("live");
    setActiveSession(id);
    renderLiveEmptyState();
    return sess;
  }

  function setActiveSession(id) {
    activeSessionID = id;
    liveSessions.forEach((s) => {
      if (s.mount) s.mount.hidden = s.id !== id;
    });
    renderLiveTabs();
    renderLiveToolbar();
    const sess = liveSessions.find((s) => s.id === id);
    if (sess && sess.kind === "ssh" && sess.fit) {
      setTimeout(() => {
        try { sess.fit.fit(); } catch (_) {}
        if (sess.ws && sess.ws.readyState === WebSocket.OPEN && sess.term) {
          sess.ws.send(JSON.stringify({ type: "resize", cols: sess.term.cols, rows: sess.term.rows }));
        }
      }, 0);
    }
  }

  function renderLiveTabs() {
    const el = liveTabsEl();
    if (!el) return;
    if (liveSessions.length === 0) { el.innerHTML = ""; return; }
    el.innerHTML = liveSessions
      .map((s) => {
        const label = s.asset.name || s.asset.id || "session";
        const active = s.id === activeSessionID ? " active" : "";
        return '<div class="live-tab' + active + '" data-ls-id="' + safe(s.id) + '" title="' + safe(label) + '">' +
          '<span class="kind-tag">' + (s.kind === "rdp" ? "RDP" : "SSH") + '</span>' +
          '<span class="label">' + safe(label) + '</span>' +
          '<button type="button" class="close" data-ls-close="' + safe(s.id) + '" aria-label="Close">✕</button>' +
        '</div>';
      }).join("");
  }

  function renderLiveToolbar() {
    const el = liveToolbarEl();
    if (!el) return;
    const sess = liveSessions.find((s) => s.id === activeSessionID);
    if (!sess) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const kindLabel = sess.kind === "rdp" ? "RDP" : "SSH";
    const eyebrow = kindLabel + " · " + safe(sess.asset.type || "asset") +
      (sess.asset.env ? " · " + safe(sess.asset.env) : "");
    const tone = toneForStatus(sess.status);
    el.innerHTML =
      '<span class="eyebrow">' + eyebrow + '</span>' +
      '<span class="active-title">' + safe(sess.asset.name || sess.asset.id || "") + '</span>' +
      '<span class="status-pill pill ' + tone + '">' + safe(sess.status) + '</span>' +
      '<button type="button" class="btn ghost" data-ls-action="reconnect">⟳ Reconnect</button>' +
      '<button type="button" class="btn ghost" data-ls-action="duplicate">⧉ Duplicate</button>' +
      '<button type="button" class="btn ghost" data-ls-action="close">✕ Close</button>';
  }

  function renderLiveEmptyState() {
    const empty = liveEmptyEl();
    const body = liveBodyEl();
    const tabs = liveTabsEl();
    const toolbar = liveToolbarEl();
    const hasSessions = liveSessions.length > 0;
    if (empty) empty.hidden = hasSessions;
    if (body) body.hidden = !hasSessions;
    if (tabs) tabs.hidden = !hasSessions;
    if (toolbar && !hasSessions) { toolbar.hidden = true; toolbar.innerHTML = ""; }
  }

  function toneForStatus(status) {
    if (status === "connected") return "success";
    if (status === "error") return "danger";
    return "neutral";
  }

  function setSessionStatus(sess, status) {
    sess.status = status;
    if (sess.id === activeSessionID) renderLiveToolbar();
  }

  function closeLiveSession(sess) {
    teardownSessionConnection(sess);
    if (sess.mount && sess.mount.parentNode) sess.mount.parentNode.removeChild(sess.mount);
    const idx = liveSessions.indexOf(sess);
    if (idx >= 0) liveSessions.splice(idx, 1);
    if (activeSessionID === sess.id) {
      const next = liveSessions[Math.min(idx, liveSessions.length - 1)];
      activeSessionID = next ? next.id : null;
    }
    if (activeSessionID) setActiveSession(activeSessionID);
    else { renderLiveTabs(); renderLiveToolbar(); }
    renderLiveEmptyState();
  }

  function teardownSessionConnection(sess) {
    if (sess.kind === "ssh") {
      if (sess.ws) { try { sess.ws.close(); } catch (_) {} sess.ws = null; }
      if (sess.term) { try { sess.term.dispose(); } catch (_) {} sess.term = null; }
      if (sess.onResize) { window.removeEventListener("resize", sess.onResize); sess.onResize = null; }
      sess.fit = null;
    } else if (sess.kind === "rdp") {
      if (sess.client) { try { sess.client.disconnect(); } catch (_) {} sess.client = null; }
      if (sess.keyboard) {
        try { sess.keyboard.onkeydown = sess.keyboard.onkeyup = null; } catch (_) {}
        sess.keyboard = null;
      }
      if (sess.mouse) {
        try { sess.mouse.onmousedown = sess.mouse.onmouseup = sess.mouse.onmousemove = null; } catch (_) {}
        sess.mouse = null;
      }
      sess.tunnel = null;
    }
    if (sess.mount) sess.mount.innerHTML = "";
  }

  async function reconnectLiveSession(sess) {
    setSessionStatus(sess, "reconnecting");
    teardownSessionConnection(sess);
    try {
      const asset = await api("/api/v1/cmdb/assets/" + encodeURIComponent(sess.asset.id));
      sess.asset = { id: asset.id, name: asset.name, type: asset.type, env: asset.env };
      renderLiveTabs();
      if (sess.id === activeSessionID) renderLiveToolbar();
      if (sess.kind === "ssh") {
        const resp = await api("/api/v1/cmdb/assets/" + encodeURIComponent(asset.id) + "/terminal/ticket", { method: "POST", body: "{}" });
        if (!resp || !resp.ticket) throw new Error("no ticket returned");
        attachSSHToSession(sess, resp.ticket);
      } else {
        const resp = await api("/api/v1/cmdb/assets/" + encodeURIComponent(asset.id) + "/rdp/ticket", { method: "POST", body: "{}" });
        if (!resp || !resp.ticket) throw new Error("no ticket returned");
        attachRDPToSession(sess, resp.ticket);
      }
    } catch (err) {
      setSessionStatus(sess, "error");
      if (!handleConnectError(err, sess.asset, sess.kind)) {
        toast("Reconnect failed: " + err.message, "error");
      }
    }
  }

  async function duplicateLiveSession(sess) {
    try {
      if (sess.kind === "ssh") {
        await connectAssetFromList(sess.asset.id);
      } else {
        const asset = await api("/api/v1/cmdb/assets/" + encodeURIComponent(sess.asset.id));
        const resp = await api("/api/v1/cmdb/assets/" + encodeURIComponent(asset.id) + "/rdp/ticket", { method: "POST", body: "{}" });
        if (!resp || !resp.ticket) throw new Error("no ticket returned");
        const newSess = createLiveSession({ kind: "rdp", asset });
        attachRDPToSession(newSess, resp.ticket);
      }
    } catch (err) {
      toast("Duplicate failed: " + err.message, "error");
    }
  }

  function findLiveSession(id) {
    return liveSessions.find((s) => s.id === id) || null;
  }

  function setSessionsPane(pane) {
    const live = $("sessions-pane-live");
    const audit = $("sessions-pane-audit");
    if (live) live.hidden = pane !== "live";
    if (audit) audit.hidden = pane !== "audit";
    document.querySelectorAll("#sessions-tab-switcher .sessions-tab").forEach((btn) => {
      const isActive = btn.dataset.sessionsPane === pane;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    if (pane === "live" && activeSessionID) {
      const sess = liveSessions.find((s) => s.id === activeSessionID);
      if (sess && sess.kind === "ssh" && sess.fit) {
        setTimeout(() => { try { sess.fit.fit(); } catch (_) {} }, 0);
      }
    }
  }

  function bindLiveSessionsEvents() {
    const switcher = $("sessions-tab-switcher");
    if (switcher) {
      switcher.addEventListener("click", (e) => {
        const btn = e.target.closest(".sessions-tab[data-sessions-pane]");
        if (!btn) return;
        // Route through the top-level navigation so the URL and the
        // section sub-nav both stay in sync with the chosen pane.
        setView("sessions", btn.dataset.sessionsPane);
      });
    }
    const tabs = liveTabsEl();
    if (tabs) {
      tabs.addEventListener("click", (e) => {
        const closeBtn = e.target.closest("[data-ls-close]");
        if (closeBtn) {
          e.stopPropagation();
          const s = findLiveSession(closeBtn.dataset.lsClose);
          if (s) closeLiveSession(s);
          return;
        }
        const tab = e.target.closest(".live-tab[data-ls-id]");
        if (!tab) return;
        setActiveSession(tab.dataset.lsId);
      });
    }
    const toolbar = liveToolbarEl();
    if (toolbar) {
      toolbar.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-ls-action]");
        if (!btn) return;
        const sess = liveSessions.find((s) => s.id === activeSessionID);
        if (!sess) return;
        const action = btn.dataset.lsAction;
        if (action === "close") closeLiveSession(sess);
        else if (action === "reconnect") reconnectLiveSession(sess);
        else if (action === "duplicate") duplicateLiveSession(sess);
      });
    }
    const empty = liveEmptyEl();
    if (empty) {
      empty.addEventListener("click", (e) => {
        const link = e.target.closest("[data-nav]");
        if (!link) return;
        e.preventDefault();
        setView(link.dataset.nav);
      });
    }
  }

  // ===== Per-session connection attach =====

  function attachSSHToSession(sess, ticket) {
    if (!window.Terminal) {
      setSessionStatus(sess, "error");
      toast("Terminal component not loaded", "error");
      return;
    }
    const asset = sess.asset;
    setSessionStatus(sess, "connecting");
    sess.mount.innerHTML = "";

    const term = new window.Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", Menlo, monospace',
      theme: { background: "#000000" },
    });
    const FitCtor = window.FitAddon && window.FitAddon.FitAddon;
    const fit = FitCtor ? new FitCtor() : null;
    if (fit) term.loadAddon(fit);
    term.open(sess.mount);
    if (fit) { try { fit.fit(); } catch (_) {} }
    sess.term = term;
    sess.fit = fit;

    const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = wsProto + "//" + location.host + "/ws/v1/cmdb/assets/" +
      encodeURIComponent(asset.id) + "/terminal?ticket=" + encodeURIComponent(ticket);
    const ws = new WebSocket(url);
    sess.ws = ws;

    ws.onopen = () => {
      setSessionStatus(sess, "connected");
      if (fit) {
        try { fit.fit(); } catch (_) {}
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
      logActivity("Terminal opened for " + (asset.name || asset.id), "info");
    };
    ws.onmessage = (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch (e) { return; }
      if (frame.type === "data") {
        term.write(frame.payload || "");
      } else if (frame.type === "error") {
        term.write("\r\n\x1b[31m[error] " + (frame.message || "") + "\x1b[0m\r\n");
        setSessionStatus(sess, "error");
        maybeShowHostKeyBanner(sess, frame.message || "");
      } else if (frame.type === "exit") {
        term.write("\r\n\x1b[33m[session exited code=" + (frame.code || 0) + "]\x1b[0m\r\n");
        setSessionStatus(sess, "closed");
      }
    };
    ws.onclose = () => {
      if (sess.status !== "error" && sess.status !== "closed") {
        setSessionStatus(sess, "disconnected");
      }
    };
    ws.onerror = () => setSessionStatus(sess, "error");

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", payload: data }));
      }
    });

    const onResize = () => {
      if (fit) { try { fit.fit(); } catch (_) {} }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", onResize);
    sess.onResize = onResize;
  }

  function attachRDPToSession(sess, ticket) {
    if (!window.Guacamole) {
      setSessionStatus(sess, "error");
      toast("Guacamole client not loaded", "error");
      return;
    }
    const asset = sess.asset;
    setSessionStatus(sess, "connecting");
    sess.mount.innerHTML = "";
    const scroll = document.createElement("div");
    scroll.className = "guac-scroll";
    sess.mount.appendChild(scroll);

    const rect = sess.mount.getBoundingClientRect();
    const width = Math.max(800, Math.floor(rect.width || 1024));
    const height = Math.max(600, Math.floor(rect.height || 720));
    const dpi = Math.round((window.devicePixelRatio || 1) * 96);
    const tz = (Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";

    const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
    const base = wsProto + "//" + location.host + "/ws/v1/cmdb/assets/" +
      encodeURIComponent(asset.id) + "/rdp";
    const tunnel = new window.Guacamole.WebSocketTunnel(base);
    const client = new window.Guacamole.Client(tunnel);
    scroll.appendChild(client.getDisplay().getElement());

    client.onstatechange = (s) => {
      if (s === 3) {
        setSessionStatus(sess, "connected");
        logActivity("RDP opened for " + (asset.name || asset.id), "info");
      } else if (s === 5) {
        if (sess.status !== "error") setSessionStatus(sess, "disconnected");
      }
    };
    client.onerror = (err) => {
      setSessionStatus(sess, "error");
      toast("RDP error: " + ((err && err.message) || "connection error"), "error");
    };

    const params = new URLSearchParams({
      ticket, width: String(width), height: String(height), dpi: String(dpi), timezone: tz,
    });
    client.connect(params.toString());

    const display = client.getDisplay();
    const mouse = new window.Guacamole.Mouse(scroll);
    mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = (mouseState) => {
      const scale = display.getScale() || 1;
      client.sendMouseState({
        x: mouseState.x / scale,
        y: mouseState.y / scale,
        left: mouseState.left,
        middle: mouseState.middle,
        right: mouseState.right,
        up: mouseState.up,
        down: mouseState.down,
      });
    };
    // Keyboard is scoped to the mount so only the visible session receives keystrokes.
    const keyboard = new window.Guacamole.Keyboard(sess.mount);
    keyboard.onkeydown = (keysym) => client.sendKeyEvent(1, keysym);
    keyboard.onkeyup = (keysym) => client.sendKeyEvent(0, keysym);
    sess.mount.addEventListener("mousedown", () => {
      try { sess.mount.focus(); } catch (_) {}
    });

    sess.client = client;
    sess.tunnel = tunnel;
    sess.keyboard = keyboard;
    sess.mouse = mouse;
  }

  // ===== Entry points =====

  async function connectAssetFromList(assetID) {
    try {
      const asset = await api("/api/v1/cmdb/assets/" + encodeURIComponent(assetID));
      let conn = null;
      try {
        conn = await api("/api/v1/cmdb/assets/" + encodeURIComponent(assetID) + "/connection");
      } catch (e) {
        if (!/404|not found/i.test(String(e.message))) throw e;
      }
      if (!conn) {
        toast("This asset has no connection profile — open it and save SSH credentials first.", "error");
        openAssetDrawer(assetID);
        return;
      }
      if (conn.protocol !== "ssh") {
        toast("Terminal is only available for SSH connections (found " + conn.protocol + ").", "error");
        return;
      }
      if (!conn.has_password && !conn.has_private_key && !asset.key_name) {
        toast("SSH connection has no credentials saved.", "error");
        openAssetDrawer(assetID);
        return;
      }
      const resp = await api(
        "/api/v1/cmdb/assets/" + encodeURIComponent(assetID) + "/terminal/ticket",
        { method: "POST", body: "{}" }
      );
      if (!resp || !resp.ticket) throw new Error("no ticket returned");
      const sess = createLiveSession({ kind: "ssh", asset });
      attachSSHToSession(sess, resp.ticket);
    } catch (error) {
      if (!handleConnectError(error, { id: assetID }, "ssh")) {
        toast("Connect failed: " + error.message, "error");
      }
    }
  }

  async function openTerminalForCurrentAsset() {
    const asset = state.assetDrawer.asset;
    if (!asset) return;
    try {
      const resp = await api(
        "/api/v1/cmdb/assets/" + encodeURIComponent(asset.id) + "/terminal/ticket",
        { method: "POST", body: "{}" }
      );
      if (!resp || !resp.ticket) throw new Error("no ticket returned");
      const sess = createLiveSession({ kind: "ssh", asset });
      attachSSHToSession(sess, resp.ticket);
    } catch (error) {
      if (!handleConnectError(error, asset, "ssh")) {
        toast("Terminal open failed: " + error.message, "error");
      }
    }
  }

  async function openRDPForCurrentAsset() {
    const asset = state.assetDrawer.asset;
    if (!asset) return;
    if (!window.Guacamole) {
      toast("Guacamole client not loaded", "error");
      return;
    }
    try {
      const resp = await api(
        "/api/v1/cmdb/assets/" + encodeURIComponent(asset.id) + "/rdp/ticket",
        { method: "POST", body: "{}" }
      );
      if (!resp || !resp.ticket) throw new Error("no ticket returned");
      const sess = createLiveSession({ kind: "rdp", asset });
      attachRDPToSession(sess, resp.ticket);
    } catch (error) {
      if (!handleConnectError(error, asset, "rdp")) {
        toast("RDP open failed: " + error.message, "error");
      }
    }
  }

  function maybeShowHostKeyBanner(sess, message) {
    if (!/host key mismatch/i.test(message)) return;
    const mount = sess.mount;
    if (!mount || mount.querySelector(".terminal-hostkey-banner")) return;
    const banner = document.createElement("div");
    banner.className = "terminal-hostkey-banner";
    const canWrite = writeAccess();
    banner.innerHTML =
      '<div class="hostkey-banner-title">Host key mismatch</div>' +
      '<div class="hostkey-banner-msg">The server presented a different SSH host key than what was previously pinned. ' +
      'This could be a legitimate re-key, or a man-in-the-middle attempt.</div>' +
      (canWrite
        ? '<button class="btn primary" data-action="override-retry">Approve one-time override & reconnect</button> '
        : '<span class="muted">Ask an admin to approve an override on the Host keys page.</span>') +
      ' <button class="btn ghost" data-action="close-banner">Dismiss</button>';
    mount.appendChild(banner);
    banner.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (btn.dataset.action === "close-banner") { banner.remove(); return; }
        if (btn.dataset.action === "override-retry") {
          btn.disabled = true;
          btn.textContent = "Approving…";
          try {
            await api("/api/v1/cmdb/hostkeys/asset/" + encodeURIComponent(sess.asset.id) + "/override", { method: "POST", body: "{}" });
            toast("Override approved, reconnecting", "success");
            reconnectLiveSession(sess);
          } catch (err) {
            toast("Override failed: " + err.message, "error");
            btn.disabled = false;
            btn.textContent = "Approve one-time override & reconnect";
          }
        }
      });
    });
  }

  function renderLabelsEditor() {
    const rows = state.assetDrawer.labels
      .map((row, idx) =>
        '<div class="label-row" data-row="' + idx + '">' +
        '<input type="text" data-field="k" value="' + safe(row.k) + '" placeholder="key" />' +
        '<input type="text" data-field="v" value="' + safe(row.v) + '" placeholder="value" />' +
        '<button type="button" class="icon-btn" data-action="remove" aria-label="Remove">' +
        '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '</div>'
      )
      .join("");
    return (
      '<div class="labels-editor" id="labels-editor">' +
      rows +
      '<button type="button" class="btn ghost" data-action="add">+ Add label</button>' +
      '</div>'
    );
  }

  function renderLabelsReadOnly() {
    const labels = state.assetDrawer.asset.labels || {};
    const rows = Object.keys(labels)
      .sort()
      .map((k) => {
        const v = labels[k];
        const display = typeof v === "string" ? v : JSON.stringify(v);
        return '<tr><td>' + safe(k) + '</td><td><code>' + safe(display) + '</code></td></tr>';
      })
      .join("");
    return rows
      ? '<table class="tag-table"><tbody>' + rows + '</tbody></table>'
      : '<div class="muted">No labels.</div>';
  }

  function bindLabelsEditorEvents() {
    const editor = $("labels-editor");
    if (!editor) return;
    editor.addEventListener("input", (event) => {
      const row = event.target.closest(".label-row");
      if (!row) return;
      const idx = Number(row.dataset.row);
      const field = event.target.dataset.field;
      if (field === "k") state.assetDrawer.labels[idx].k = event.target.value;
      if (field === "v") state.assetDrawer.labels[idx].v = event.target.value;
    });
    editor.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (!action) return;
      const kind = action.dataset.action;
      if (kind === "add") {
        state.assetDrawer.labels.push({ k: "", v: "" });
        renderAssetDrawer();
      } else if (kind === "remove") {
        const row = action.closest(".label-row");
        const idx = Number(row.dataset.row);
        state.assetDrawer.labels.splice(idx, 1);
        renderAssetDrawer();
      }
    });

    const saveBtn = $("drawer-save-btn");
    if (saveBtn) saveBtn.addEventListener("click", saveAssetLabels);
    const cancelBtn = $("drawer-cancel-btn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        const asset = state.assetDrawer.asset;
        state.assetDrawer.labels = Object.entries(asset.labels || {}).map(([k, v]) => ({
          k,
          v: typeof v === "string" ? v : JSON.stringify(v),
        }));
        renderAssetDrawer();
      });
    }
  }

  async function saveAssetLabels() {
    const asset = state.assetDrawer.asset;
    if (!asset) return;
    const labels = {};
    for (const row of state.assetDrawer.labels) {
      const k = row.k.trim();
      if (!k) continue;
      labels[k] = row.v;
    }
    try {
      const updated = await api("/api/v1/cmdb/assets/" + encodeURIComponent(asset.id), {
        method: "PATCH",
        body: JSON.stringify({ labels: labels }),
      });
      state.assetDrawer.asset = updated;
      state.assetDrawer.labels = Object.entries(updated.labels || {}).map(([k, v]) => ({
        k,
        v: typeof v === "string" ? v : JSON.stringify(v),
      }));
      renderAssetDrawer();
      toast("Labels saved", "success");
      logActivity("Updated labels on " + (updated.name || asset.id), "success");
      refreshAssets();
    } catch (error) {
      toast("Save failed: " + error.message, "error");
    }
  }

  function section(title, body) {
    return (
      '<div class="drawer-section">' +
      '<h3>' + safe(title) + '</h3>' +
      body +
      '</div>'
    );
  }

  function kvList(pairs) {
    const rows = pairs
      .map(([k, v]) => '<div class="k">' + safe(k) + '</div><div class="v">' + v + '</div>')
      .join("");
    return '<div class="kv-list">' + rows + '</div>';
  }

  function dash() {
    return '<span class="muted">—</span>';
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch (e) {
      return iso;
    }
  }

  // summarizeAwsSyncByAccount walks awsSyncRuns once and returns a map of
  // account_id → { lastRun, lastSuccess, lastFailure }. Used by the accounts
  // table to surface "Last sync" inline so operators don't have to scroll the
  // sync history to find which account is broken.
  function summarizeAwsSyncByAccount() {
    const out = {};
    (state.awsSyncRuns || []).forEach((run) => {
      const id = run.account_id || "";
      if (!id) return;
      if (!out[id]) out[id] = { lastRun: null, lastSuccess: null, lastFailure: null };
      const slot = out[id];
      const t = new Date(run.started_at).getTime();
      const lastT = slot.lastRun ? new Date(slot.lastRun.started_at).getTime() : 0;
      if (t >= lastT) slot.lastRun = run;
      if (run.status === "success") {
        const okT = slot.lastSuccess ? new Date(slot.lastSuccess.started_at).getTime() : 0;
        if (t >= okT) slot.lastSuccess = run;
      }
      if (run.status === "failed") {
        const failT = slot.lastFailure ? new Date(slot.lastFailure.started_at).getTime() : 0;
        if (t >= failT) slot.lastFailure = run;
      }
    });
    return out;
  }

  function renderAwsAccounts() {
    if (!hasPermission("aws.account:read")) {
      elements.cloudAccountsBody.innerHTML =
        '<tr class="empty-row"><td colspan="7">Permission required: aws.account:read</td></tr>';
      return;
    }

    if (state.awsAccounts.length === 0) {
      elements.cloudAccountsBody.innerHTML =
        '<tr class="empty-row"><td colspan="7">No AWS accounts connected yet.</td></tr>';
      return;
    }

    const summary = summarizeAwsSyncByAccount();
    const canWriteAws = hasPermission("aws.account:write");

    elements.cloudAccountsBody.innerHTML = state.awsAccounts
      .map((item) => {
        const regions = (item.region_allowlist || [])
          .map((r) => '<span class="chip">' + safe(r) + '</span>')
          .join("") || '<span class="muted">none</span>';
        const roleKey = item.role_arn
          ? '<code>' + safe(item.role_arn) + '</code>'
          : item.access_key_id
          ? '<code>' + safe(item.access_key_id) + '</code>'
          : '<span class="muted">—</span>';
        const enabled = item.enabled
          ? '<span class="pill success"><span class="dot"></span>enabled</span>'
          : '<span class="pill neutral"><span class="dot"></span>disabled</span>';
        const actions = canWriteAws
          ? '<button class="btn ghost small" data-test-aws-account="' + safe(item.id) + '">Test</button>'
          : "";

        // Last-sync column: prefer the most recent attempt; show a danger pill
        // and a "see history" link if the latest run failed, so a broken
        // account is visible without leaving the page.
        const sum = summary[item.account_id];
        let lastSyncCell;
        if (!sum || !sum.lastRun) {
          lastSyncCell = '<span class="muted">never</span>';
        } else {
          const last = sum.lastRun;
          const rel = formatRelative(last.started_at);
          const failed = last.status === "failed";
          const pill = failed
            ? '<span class="pill danger"><span class="dot"></span>failed</span>'
            : last.status === "running"
            ? '<span class="pill warn"><span class="dot"></span>running</span>'
            : '<span class="pill success"><span class="dot"></span>ok</span>';
          const errLine = failed && last.error_message
            ? '<div class="sub muted" title="' + safe(last.error_message) + '">' +
              safe(last.error_message.length > 80 ? last.error_message.slice(0, 80) + "…" : last.error_message) +
              ' · <a href="#" class="sync-history-link" data-sync-account="' + safe(item.account_id) + '">see history</a></div>'
            : sum.lastSuccess && failed
            ? '<div class="sub muted">last ok ' + safe(formatRelative(sum.lastSuccess.started_at)) + '</div>'
            : '';
          lastSyncCell = pill + ' <span class="muted">' + safe(rel) + '</span>' + errLine;
        }

        return (
          "<tr>" +
          '<td><div class="primary">' + safe(item.display_name) + '</div>' +
          '<div class="muted">' + safe(item.account_id) + '</div></td>' +
          "<td>" + safe(item.auth_mode) + "</td>" +
          "<td>" + roleKey + "</td>" +
          '<td><div class="chips">' + regions + "</div></td>" +
          "<td>" + lastSyncCell + "</td>" +
          "<td>" + enabled + "</td>" +
          '<td style="text-align:right">' + actions + "</td>" +
          "</tr>"
        );
      })
      .join("");

    // "see history" links jump to the sync history table with the status
    // filter pre-set to failed so the user lands on the broken row.
    elements.cloudAccountsBody.querySelectorAll(".sync-history-link").forEach((link) => {
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        const sel = $("sync-runs-status-filter");
        if (sel) { sel.value = "failed"; sel.dispatchEvent(new Event("change")); }
        const target = $("sync-runs-body");
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    elements.cloudAccountsBody.querySelectorAll("button[data-test-aws-account]").forEach((btn) => {
      btn.addEventListener("click", () => testAwsAccount(btn.dataset.testAwsAccount));
    });
  }

  function renderAwsSyncStatus() {
    const host = elements.syncStatusCard;
    if (!hasPermission("aws.account:read")) {
      host.innerHTML =
        '<div class="summary-cell"><div class="label">Status</div><div class="value">Permission required</div></div>';
      return;
    }
    const s = state.awsSyncStatus;
    if (!s) {
      host.innerHTML =
        '<div class="summary-cell"><div class="label">Status</div><div class="value">Not run yet</div></div>';
      return;
    }

    const running = s.running;
    const statusPillHTML = running
      ? '<span class="pill warn"><span class="dot"></span>running</span>'
      : s.last_error
      ? '<span class="pill danger"><span class="dot"></span>failed</span>'
      : '<span class="pill success"><span class="dot"></span>idle</span>';

    const cells = [
      { label: "Status", value: statusPillHTML, raw: true },
      { label: "Last started", value: s.last_started_at ? formatRelative(s.last_started_at) : "—" },
      { label: "Last finished", value: s.last_finished_at ? formatRelative(s.last_finished_at) : "—" },
    ];
    if (s.last_error) {
      cells.push({ label: "Last error", value: s.last_error, mono: true });
    }

    host.innerHTML = cells
      .map((c) => {
        const cls = c.mono ? ' mono' : "";
        const value = c.raw ? c.value : safe(c.value);
        return '<div class="summary-cell"><div class="label">' + safe(c.label) + '</div><div class="value' + cls + '">' + value + '</div></div>';
      })
      .join("");
  }

  // syncRunsFilter: status one of "" | "success" | "failed" | "running".
  const syncRunsFilter = { status: "" };

  function renderAwsSyncRuns() {
    if (!hasPermission("aws.account:read")) {
      elements.syncRunsBody.innerHTML =
        '<tr class="empty-row"><td colspan="6">Permission required: aws.account:read</td></tr>';
      return;
    }
    const filtered = (state.awsSyncRuns || []).filter((run) =>
      !syncRunsFilter.status || run.status === syncRunsFilter.status
    );
    if (filtered.length === 0) {
      const msg = syncRunsFilter.status
        ? "No " + syncRunsFilter.status + " runs."
        : "No sync runs yet.";
      elements.syncRunsBody.innerHTML =
        '<tr class="empty-row"><td colspan="6">' + safe(msg) + '</td></tr>';
      return;
    }
    elements.syncRunsBody.innerHTML = filtered
      .map((run) => {
        // Inline error: when a run failed, show the message as a sub-line
        // under the resource type so the operator doesn't have to hover or
        // open a separate panel to see what went wrong.
        const resourceCell = run.status === "failed" && run.error_message
          ? safe(run.resource_type || "—") +
            '<div class="sub error" title="' + safe(run.error_message) + '">' +
            safe(run.error_message.length > 120 ? run.error_message.slice(0, 120) + "…" : run.error_message) +
            '</div>'
          : safe(run.resource_type || "—");
        return (
          "<tr>" +
          "<td>" + safe(formatDateTime(run.started_at)) + "</td>" +
          '<td><div class="primary">' + safe(run.account_display_name || "—") + '</div>' +
          '<div class="muted">' + safe(run.account_id || "") + "</div></td>" +
          "<td><code>" + safe(run.region || "—") + "</code></td>" +
          "<td>" + resourceCell + "</td>" +
          "<td>" + statusPill(run.status) + "</td>" +
          '<td style="text-align: right;">' + String(run.resources_processed || 0) + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function bindSyncRunsFilter() {
    const sel = $("sync-runs-status-filter");
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = "1";
    sel.addEventListener("change", () => {
      syncRunsFilter.status = sel.value || "";
      renderAwsSyncRuns();
    });
  }

  function renderIAMUserTable() {
    if (!canReadIAM()) {
      elements.iamUsersTableBody.innerHTML =
        '<tr class="empty-row"><td colspan="3">Permission required: iam.user:read</td></tr>';
      return;
    }
    if (state.iamUsers.length === 0) {
      elements.iamUsersTableBody.innerHTML =
        '<tr class="empty-row"><td colspan="3">No users yet.</td></tr>';
      return;
    }
    elements.iamUsersTableBody.innerHTML = state.iamUsers
      .map((item) => {
        const isSelected = item.id === state.selectedUserID;
        const name = item.name || item.email || item.oidc_subject || "—";
        const roles = (item.roles || []).map((r) => '<span class="chip">' + safe(r) + '</span>').join("");
        return (
          '<tr style="' + (isSelected ? "background: var(--surface);" : "") + '">' +
          "<td>" +
          '<div style="display: flex; align-items: center; gap: 10px;">' +
          '<div class="avatar" style="width: 28px; height: 28px; font-size: 11px;">' + safe(initials(name)) + '</div>' +
          '<div><div class="primary">' + safe(name) + '</div>' +
          '<div class="muted">' + safe(item.email || item.oidc_subject || "") + '</div></div>' +
          '</div></td>' +
          '<td><div class="chips">' + (roles || '<span class="muted">none</span>') + "</div></td>" +
          '<td class="row-actions"><button class="btn small iam-select-user-btn" data-user-id="' + safe(item.id) + '">' +
          (isSelected ? "Selected" : "Select") +
          "</button></td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderIAMRolesTable() {
    if (!canReadIAM()) {
      elements.iamRolesTableBody.innerHTML =
        '<tr class="empty-row"><td colspan="3">Permission required: iam.user:read</td></tr>';
      return;
    }
    if (state.iamRoles.length === 0) {
      elements.iamRolesTableBody.innerHTML =
        '<tr class="empty-row"><td colspan="3">No roles configured.</td></tr>';
      return;
    }
    elements.iamRolesTableBody.innerHTML = state.iamRoles
      .map((role) => {
        return (
          '<tr style="cursor: pointer;" class="iam-view-role-btn" data-role-name="' + safe(role.name) + '">' +
          "<td><strong>" + safe(role.name) + "</strong></td>" +
          '<td><span class="muted">' + safe(role.description || "—") + "</span></td>" +
          '<td style="text-align: right;">' + String((role.permissions || []).length) + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function populateIAMRoleSelect() {
    elements.iamRoleSelect.innerHTML = "";
    if (state.iamRoles.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No role available";
      elements.iamRoleSelect.appendChild(option);
      return;
    }
    state.iamRoles.forEach((role) => {
      const option = document.createElement("option");
      option.value = role.name;
      option.textContent = role.name;
      elements.iamRoleSelect.appendChild(option);
    });
  }

  function renderIAMSelectedUser() {
    if (!state.selectedUserIdentity) {
      elements.iamSelectedUser.innerHTML = '<div class="timeline-empty">Select a user to view their access.</div>';
      elements.iamUserRoles.innerHTML = "";
      return;
    }
    const identity = state.selectedUserIdentity;
    const user = identity.user || {};
    const name = user.name || user.email || user.oidc_subject || "User";
    elements.iamSelectedUser.innerHTML =
      '<div class="identity-card">' +
      '<div class="avatar">' + safe(initials(name)) + '</div>' +
      '<div class="identity-meta">' +
      '<div class="name">' + safe(name) + '</div>' +
      (user.email ? '<div class="sub">' + safe(user.email) + "</div>" : '') +
      '<div class="sub">' + safe(user.oidc_subject || "") + "</div>" +
      "</div></div>" +
      '<div class="summary-grid" style="margin-top: 16px;">' +
      '<div class="summary-cell"><div class="label">Roles</div><div class="value">' + (identity.roles || []).length + "</div></div>" +
      '<div class="summary-cell"><div class="label">Permissions</div><div class="value">' + (identity.permissions || []).length + "</div></div>" +
      "</div>";

    if (!identity.roles || identity.roles.length === 0) {
      elements.iamUserRoles.innerHTML = '<span class="muted" style="font-size: 12px;">No role bindings</span>';
      return;
    }

    elements.iamUserRoles.innerHTML = identity.roles
      .map((roleName) => {
        const unbind = canWriteIAM()
          ? '<button class="iam-unbind-role-btn" data-role-name="' + safe(roleName) + '" title="Unbind"><svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg></button>'
          : "";
        return '<span class="chip accent">' + safe(roleName) + unbind + "</span>";
      })
      .join("");
  }

  function renderRolePermissions(role) {
    if (!role) {
      elements.iamRolePermissionsOutput.innerHTML = '<div class="timeline-empty">Select a role to view permissions.</div>';
      return;
    }
    const perms = role.permissions || [];
    if (perms.length === 0) {
      elements.iamRolePermissionsOutput.innerHTML =
        '<div style="padding: 0;"><strong>' + safe(role.name) + "</strong>" +
        '<div class="muted" style="margin-top: 4px;">' + safe(role.description || "") + "</div>" +
        '<div class="timeline-empty" style="padding: 16px 0;">No permissions.</div></div>';
      return;
    }

    const groups = {};
    perms.forEach((p) => {
      const resource = p.resource || "other";
      if (!groups[resource]) groups[resource] = [];
      groups[resource].push(p.action);
    });

    let html =
      '<div><strong>' + safe(role.name) + "</strong>" +
      '<div class="muted" style="margin-top: 4px; margin-bottom: 14px;">' + safe(role.description || "") + "</div>";

    Object.keys(groups).sort().forEach((resource) => {
      html += '<div class="perm-group"><div class="perm-group-name">' + safe(resource) + '</div><div class="chips">';
      html += groups[resource].map((a) => '<span class="chip">' + safe(a) + "</span>").join("");
      html += "</div></div>";
    });
    html += "</div>";
    elements.iamRolePermissionsOutput.innerHTML = html;
  }

  function renderOIDCSettings() {
    if (!state.oidcSettings) return;
    const s = state.oidcSettings;
    elements.oidcEnabledInput.checked = !!s.enabled;
    elements.oidcIssuerURLInput.value = s.issuer_url || "";
    elements.oidcClientIDInput.value = s.client_id || "";
    elements.oidcClientSecretInput.value = "";
    if (s.has_client_secret) {
      elements.oidcClientSecretInput.placeholder = "•••••••• (saved, leave empty to keep)";
    }
    elements.oidcRedirectURLInput.value = s.redirect_url || "";
    elements.oidcAuthorizeURLInput.value = s.authorize_url || "";
    elements.oidcTokenURLInput.value = s.token_url || "";
    elements.oidcUserInfoURLInput.value = s.userinfo_url || "";
    elements.oidcScopesInput.value = (s.scopes || []).join(", ");
  }

  function applyPermissionUI() {
    const canWriteAsset = hasPermission("cmdb.asset:write");
    elements.toggleAssetFormBtn.disabled = !canWriteAsset;

    const canWriteAws = hasPermission("aws.account:write");
    elements.toggleAwsFormBtn.disabled = !canWriteAws;
    elements.triggerAwsSyncBtn.disabled = !canWriteAws;

    const disableIAMRead = !canReadIAM();
    const disableIAMWrite = !canWriteIAM();
    elements.iamUserSearch.disabled = disableIAMRead;
    elements.refreshIamUsersBtn.disabled = disableIAMRead;
    elements.refreshIamSelectionBtn.disabled = disableIAMRead;
    elements.refreshIamRolesBtn.disabled = disableIAMRead;
    elements.refreshOIDCSettingsBtn.disabled = disableIAMRead;
    elements.iamRoleSelect.disabled = disableIAMRead || disableIAMWrite;
    elements.iamBindRoleBtn.disabled = disableIAMRead || disableIAMWrite || !state.selectedUserID;

    elements.oidcSettingsForm.querySelectorAll("input,button,select,textarea").forEach((el) => {
      el.disabled = disableIAMWrite;
    });
  }

  function renderShell() {
    const isAuthed = !!state.user;
    elements.authGate.classList.toggle("active", !isAuthed);
    elements.workspace.classList.toggle("active", isAuthed);
    elements.logoutBtn.disabled = !isAuthed;

    renderStats();
    renderProfile();
    renderAssetTable();
    renderAwsAccounts();
    renderAwsSyncStatus();
    renderAwsSyncRuns();
    renderIAMUserTable();
    renderIAMRolesTable();
    renderIAMSelectedUser();
    populateIAMRoleSelect();
    renderOIDCSettings();
    renderHealth();
    applyPermissionUI();
  }

  // ===== API =====

  async function api(path, options) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      options && options.headers ? options.headers : {}
    );
    if (state.token) headers.Authorization = "Bearer " + state.token;

    const response = await fetch(path, { method: "GET", ...options, headers });
    const text = await response.text();
    let payload = text;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (e) {
      payload = text;
    }

    if (!response.ok) {
      const message = typeof payload === "string" ? payload : payload.error || JSON.stringify(payload);
      const err = new Error(message);
      err.status = response.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  }

  async function refreshHealth() {
    try {
      const health = await api("/healthz");
      state.health.api = true;
      state.health.db = health && health.status === "ok";
    } catch (error) {
      state.health.api = false;
      state.health.db = false;
    }
    renderHealth();
  }

  async function refreshProfile() {
    if (!state.token) {
      state.user = null;
      state.roles = [];
      state.permissions = [];
      renderShell();
      return false;
    }
    try {
      const data = await api("/auth/me");
      state.user = data.user || null;
      state.roles = data.roles || [];
      state.permissions = data.permissions || [];
      renderShell();
      return true;
    } catch (error) {
      setToken("");
      state.user = null;
      state.roles = [];
      state.permissions = [];
      showAuthError(error.message);
      renderShell();
      return false;
    }
  }

  function buildAssetQueryString() {
    const q = state.assetQuery;
    const parts = [];
    const add = (k, v) => {
      if (v === undefined || v === null || v === "") return;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    };
    add("env", q.env);
    add("type", q.type);
    add("status", q.status);
    add("source", q.source);
    add("region", q.region);
    add("criticality", q.criticality);
    add("q", q.q);
    if (!q.includeBastions) {
      add("is_vpc_proxy", "false");
    }
    if (state.assetViewMode === "tree") {
      add("limit", 500);
      add("offset", 0);
    } else {
      add("limit", q.limit);
      add("offset", q.offset);
    }
    return parts.length ? "?" + parts.join("&") : "";
  }

  async function refreshAssets() {
    if (!hasPermission("cmdb.asset:read")) {
      state.assets = [];
      state.assetTotal = 0;
      renderShell();
      return;
    }
    try {
      const data = await api("/api/v1/cmdb/assets" + buildAssetQueryString());
      state.assets = data.items || [];
      state.assetTotal = data.total || 0;
      refreshFilterOptions();
      renderShell();
    } catch (error) {
      state.assets = [];
      state.assetTotal = 0;
      renderShell();
      logActivity("Failed to load assets: " + error.message, "error");
    }
  }

  async function refreshAwsAccounts() {
    if (!hasPermission("aws.account:read")) {
      state.awsAccounts = [];
      renderShell();
      return;
    }
    try {
      const data = await api("/api/v1/aws/accounts");
      state.awsAccounts = data.items || [];
      renderShell();
    } catch (error) {
      state.awsAccounts = [];
      renderShell();
      logActivity("Failed to load AWS accounts: " + error.message, "error");
    }
  }

  async function refreshAwsSyncStatus() {
    if (!hasPermission("aws.account:read")) {
      state.awsSyncStatus = null;
      renderShell();
      return;
    }
    try {
      state.awsSyncStatus = await api("/api/v1/aws/sync/status");
      renderShell();
    } catch (error) {
      state.awsSyncStatus = null;
      renderShell();
    }
  }

  async function refreshAwsSyncRuns() {
    if (!hasPermission("aws.account:read")) {
      state.awsSyncRuns = [];
      renderShell();
      return;
    }
    try {
      const data = await api("/api/v1/aws/sync/runs?limit=120");
      state.awsSyncRuns = data.items || [];
      renderShell();
    } catch (error) {
      state.awsSyncRuns = [];
      renderShell();
    }
  }

  async function triggerAwsSync() {
    if (!hasPermission("aws.account:write")) {
      toast("Permission required: aws.account:write", "error");
      return;
    }
    try {
      const result = await api("/api/v1/aws/sync/run", { method: "POST", body: "{}" });
      toast(result.triggered ? "AWS sync triggered" : "AWS sync already running", "success");
      logActivity(result.triggered ? "AWS sync triggered" : "AWS sync already running", "success");
      await refreshAwsSyncStatus();
      await refreshAwsSyncRuns();
    } catch (error) {
      toast("Sync trigger failed: " + error.message, "error");
      logActivity("AWS sync trigger failed", "error");
    }
  }

  async function testAwsAccount(accountID) {
    if (!hasPermission("aws.account:write")) {
      toast("Permission required: aws.account:write", "error");
      return;
    }
    if (!accountID) return;
    try {
      const result = await api("/api/v1/aws/accounts/" + encodeURIComponent(accountID) + "/test", {
        method: "POST",
        body: "{}",
      });
      toast("AWS connection OK: " + (result.arn || result.account_id || result.region), "success");
      logActivity("AWS account test succeeded", "success");
    } catch (error) {
      toast("AWS test failed: " + error.message, "error");
      logActivity("AWS account test failed: " + error.message, "error");
    }
  }

  async function refreshIAMUsers() {
    if (!canReadIAM()) {
      state.iamUsers = [];
      renderShell();
      return;
    }
    try {
      const query = (elements.iamUserSearch.value || "").trim();
      const path = query ? "/api/v1/iam/users?q=" + encodeURIComponent(query) : "/api/v1/iam/users";
      const data = await api(path);
      state.iamUsers = data.items || [];
      renderShell();
    } catch (error) {
      state.iamUsers = [];
      renderShell();
      logActivity("Failed to load IAM users: " + error.message, "error");
    }
  }

  async function refreshIAMRoles() {
    if (!canReadIAM()) {
      state.iamRoles = [];
      renderShell();
      return;
    }
    try {
      const data = await api("/api/v1/iam/roles?include_permissions=true");
      state.iamRoles = data.items || [];
      renderShell();
    } catch (error) {
      state.iamRoles = [];
      renderShell();
      logActivity("Failed to load IAM roles: " + error.message, "error");
    }
  }

  function syncSelectedUserRolesToList() {
    if (!state.selectedUserIdentity) return;
    state.iamUsers = state.iamUsers.map((item) => {
      if (item.id !== state.selectedUserID) return item;
      return Object.assign({}, item, { roles: state.selectedUserIdentity.roles || [] });
    });
  }

  async function refreshSelectedUserIdentity() {
    if (!state.selectedUserID || !canReadIAM()) {
      state.selectedUserIdentity = null;
      renderShell();
      return;
    }
    try {
      const identity = await api("/api/v1/iam/users/" + encodeURIComponent(state.selectedUserID));
      state.selectedUserIdentity = identity;
      syncSelectedUserRolesToList();
      renderShell();
    } catch (error) {
      state.selectedUserIdentity = null;
      renderShell();
      logActivity("Failed to load user: " + error.message, "error");
    }
  }

  async function viewRolePermissions(roleName) {
    if (!canReadIAM()) return;
    try {
      const data = await api("/api/v1/iam/roles/" + encodeURIComponent(roleName) + "/permissions");
      renderRolePermissions(data);
    } catch (error) {
      elements.iamRolePermissionsOutput.innerHTML =
        '<div class="timeline-empty">Failed to load: ' + safe(error.message) + "</div>";
    }
  }

  async function bindRoleToSelectedUser() {
    if (!state.selectedUserID) {
      toast("Select a user first", "error");
      return;
    }
    if (!canWriteIAM()) {
      toast("Permission required: iam.user:write", "error");
      return;
    }
    const roleName = (elements.iamRoleSelect.value || "").trim();
    if (!roleName) {
      toast("Select a role first", "error");
      return;
    }
    try {
      const identity = await api(
        "/api/v1/iam/users/" + encodeURIComponent(state.selectedUserID) + "/roles",
        { method: "POST", body: JSON.stringify({ role_name: roleName }) }
      );
      state.selectedUserIdentity = identity;
      syncSelectedUserRolesToList();
      renderShell();
      toast("Role bound: " + roleName, "success");
      logActivity("Bound role " + roleName + " to user", "success");
    } catch (error) {
      toast("Bind failed: " + error.message, "error");
    }
  }

  async function unbindRoleFromSelectedUser(roleName) {
    if (!state.selectedUserID) return;
    if (!canWriteIAM()) {
      toast("Permission required: iam.user:write", "error");
      return;
    }
    try {
      const identity = await api(
        "/api/v1/iam/users/" + encodeURIComponent(state.selectedUserID) + "/roles/" + encodeURIComponent(roleName),
        { method: "DELETE" }
      );
      state.selectedUserIdentity = identity;
      syncSelectedUserRolesToList();
      renderShell();
      toast("Role unbound: " + roleName, "success");
      logActivity("Unbound role " + roleName, "success");
    } catch (error) {
      toast("Unbind failed: " + error.message, "error");
    }
  }

  async function refreshOIDCSettings() {
    if (!canReadIAM()) {
      state.oidcSettings = null;
      return;
    }
    try {
      state.oidcSettings = await api("/api/v1/iam/oidc-config");
      renderOIDCSettings();
    } catch (error) {
      state.oidcSettings = null;
    }
  }

  async function saveOIDCSettings(event) {
    event.preventDefault();
    if (!canWriteIAM()) {
      toast("Permission required: iam.user:write", "error");
      return;
    }
    const body = oidcSettingsPayload();

    try {
      const settings = await api("/api/v1/iam/oidc-config", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      state.oidcSettings = settings;
      renderOIDCSettings();
      toast("OIDC configuration saved", "success");
      logActivity("OIDC settings updated", "success");
    } catch (error) {
      toast("Save failed: " + error.message, "error");
    }
  }

  function oidcSettingsPayload() {
    const body = {
      enabled: !!elements.oidcEnabledInput.checked,
      issuer_url: (elements.oidcIssuerURLInput.value || "").trim(),
      client_id: (elements.oidcClientIDInput.value || "").trim(),
      client_secret: elements.oidcClientSecretInput.value || "",
      redirect_url: (elements.oidcRedirectURLInput.value || "").trim(),
      authorize_url: (elements.oidcAuthorizeURLInput.value || "").trim(),
      token_url: (elements.oidcTokenURLInput.value || "").trim(),
      userinfo_url: (elements.oidcUserInfoURLInput.value || "").trim(),
      scopes: parseScopes(elements.oidcScopesInput.value || ""),
    };
    if (!body.client_secret) delete body.client_secret;
    return body;
  }

  async function testOIDCSettings() {
    if (!canWriteIAM()) {
      toast("Permission required: iam.user:write", "error");
      return;
    }
    try {
      const result = await api("/api/v1/iam/oidc-config/test", {
        method: "POST",
        body: JSON.stringify(oidcSettingsPayload()),
      });
      toast("OIDC connection OK: " + (result.http_status || result.status), "success");
      logActivity("OIDC connection test succeeded", "success");
    } catch (error) {
      toast("OIDC test failed: " + error.message, "error");
      logActivity("OIDC connection test failed: " + error.message, "error");
    }
  }

  // openCreateAssetModal renders the create-asset form inside the shared
  // modal primitive. Replaces the old top-of-page panel that pushed the
  // inventory below the fold every time it was opened.
  function openCreateAssetModal() {
    if (!hasPermission("cmdb.asset:write")) {
      toast("You don't have permission to create assets.", "error");
      return;
    }
    const body =
      '<form id="ui-asset-create-form">' +
        '<div class="form-grid">' +
          '<div class="field"><label>Name</label><input name="name" required autofocus /></div>' +
          '<div class="field"><label>Type</label><input name="type" placeholder="e.g. server, database" required /></div>' +
          '<div class="field"><label>Environment</label><input name="env" placeholder="default" /></div>' +
          '<div class="field"><label>Status</label><input name="status" placeholder="active" /></div>' +
          '<div class="field"><label>Criticality</label>' +
            '<select name="criticality"><option value="">—</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="critical">critical</option></select></div>' +
          '<div class="field"><label>Owner</label><input name="owner" placeholder="team or individual" /></div>' +
          '<div class="field"><label>Business unit</label><input name="business_unit" /></div>' +
          '<div class="field"><label>Region</label><input name="region" /></div>' +
          '<div class="field"><label>Account ID</label><input name="account_id" /></div>' +
          '<div class="field"><label>Instance type</label><input name="instance_type" /></div>' +
          '<div class="field"><label>External ID</label><input name="external_id" /></div>' +
          '<div class="field"><label>Public IP</label><input name="public_ip" /></div>' +
          '<div class="field"><label>Private IP</label><input name="private_ip" /></div>' +
          '<div class="field"><label>Private DNS</label><input name="private_dns" /></div>' +
        '</div>' +
      '</form>';

    openModal({
      title: "Create asset",
      size: "lg",
      body,
      actions: [
        { label: "Cancel", variant: "ghost", onClick: ({ close }) => close() },
        {
          label: "Create asset",
          variant: "primary",
          onClick: async (ctx) => {
            const form = ctx.root.querySelector("#ui-asset-create-form");
            if (!form.reportValidity()) return;
            ctx.setBusy("Creating…");
            const data = new FormData(form);
            const s = (k) => String(data.get(k) || "").trim();
            const payload = {
              name: s("name"),
              type: s("type"),
              env: s("env") || "default",
              status: s("status") || "active",
              source: "manual",
              external_id: s("external_id"),
              public_ip: s("public_ip"),
              private_ip: s("private_ip"),
              private_dns: s("private_dns"),
              region: s("region"),
              account_id: s("account_id"),
              instance_type: s("instance_type"),
              owner: s("owner"),
              business_unit: s("business_unit"),
              criticality: s("criticality"),
            };
            try {
              await api("/api/v1/cmdb/assets", { method: "POST", body: JSON.stringify(payload) });
              toast("Asset created: " + payload.name, "success");
              logActivity("Asset created: " + payload.name, "success");
              ctx.close();
              await refreshAssets();
            } catch (err) {
              ctx.setBusy(null);
              toast("Create failed: " + err.message, "error");
            }
          },
        },
      ],
    });
  }

  // openCreateAwsAccountModal renders the Connect-AWS-Account form inside
  // the shared modal (Redesign Phase 4). Replaces the old top-of-page panel
  // — same pattern as Phase 2 asset create.
  function openCreateAwsAccountModal() {
    if (!hasPermission("aws.account:write")) {
      toast("You don't have permission to add accounts.", "error");
      return;
    }
    const body =
      '<form id="ui-aws-create-form">' +
        '<div class="form-grid">' +
          '<div class="field"><label>Account ID</label><input name="account_id" placeholder="12-digit AWS account ID" required autofocus /></div>' +
          '<div class="field"><label>Display name</label><input name="display_name" required /></div>' +
          '<div class="field"><label>Auth mode</label>' +
            '<select name="auth_mode"><option value="assume_role">Assume role</option><option value="static">Static keys</option></select></div>' +
          '<div class="field"><label>Role ARN</label><input name="role_arn" placeholder="arn:aws:iam::..." />' +
            '<span class="hint">Required for assume_role mode.</span></div>' +
          '<div class="field"><label>External ID</label><input name="external_id" />' +
            '<span class="hint">Optional trust-policy external ID.</span></div>' +
          '<div class="field"><label>Access key ID</label><input name="access_key_id" /></div>' +
          '<div class="field"><label>Secret access key</label><input name="secret_access_key" type="password" /></div>' +
          '<div class="field full"><label>Regions</label><input name="region_allowlist" placeholder="us-east-1, ap-southeast-1" />' +
            '<span class="hint">Comma-separated. Only these regions will be synced.</span></div>' +
        '</div>' +
      '</form>';

    openModal({
      title: "Connect AWS account",
      size: "lg",
      body,
      actions: [
        { label: "Cancel", variant: "ghost", onClick: ({ close }) => close() },
        {
          label: "Add account",
          variant: "primary",
          onClick: async (ctx) => {
            const form = ctx.root.querySelector("#ui-aws-create-form");
            if (!form.reportValidity()) return;
            ctx.setBusy("Adding…");
            const data = new FormData(form);
            const payload = {
              account_id: String(data.get("account_id") || "").trim(),
              display_name: String(data.get("display_name") || "").trim(),
              auth_mode: String(data.get("auth_mode") || "assume_role"),
              role_arn: String(data.get("role_arn") || "").trim(),
              access_key_id: String(data.get("access_key_id") || "").trim(),
              secret_access_key: String(data.get("secret_access_key") || "").trim(),
              external_id: String(data.get("external_id") || "").trim(),
              region_allowlist: parseCSV(String(data.get("region_allowlist") || "")),
              enabled: true,
            };
            try {
              await api("/api/v1/aws/accounts", { method: "POST", body: JSON.stringify(payload) });
              toast("AWS account added: " + payload.account_id, "success");
              logActivity("AWS account added: " + payload.account_id, "success");
              ctx.close();
              await refreshAwsAccounts();
            } catch (err) {
              ctx.setBusy(null);
              toast("Create failed: " + err.message, "error");
            }
          },
        },
      ],
    });
  }

  async function loadAuthorizedData() {
    await Promise.all([
      refreshAssets(),
      refreshAwsAccounts(),
      refreshAwsSyncStatus(),
      refreshAwsSyncRuns(),
      refreshIAMUsers(),
      refreshIAMRoles(),
      refreshOIDCSettings(),
    ]);
    await refreshSelectedUserIdentity();
    renderShell();
  }

  async function localLogin(event) {
    event.preventDefault();
    showAuthError("");
    const username = String(elements.localUsername.value || "").trim();
    const password = String(elements.localPassword.value || "");
    if (!username || !password) {
      showAuthError("Username and password are required.");
      return;
    }
    try {
      const data = await api("/auth/local/login", {
        method: "POST",
        body: JSON.stringify({ username: username, password: password }),
      });
      setToken(data.access_token || "");
      elements.localPassword.value = "";
      logActivity("Signed in as " + username, "success");
      const ok = await refreshProfile();
      if (ok) {
        await loadAuthorizedData();
        toast("Welcome back, " + (state.user.name || username), "success");
      }
    } catch (error) {
      showAuthError(error.message);
    }
  }

  function oidcLogin() {
    window.location.href = "/auth/oidc/login?next=" + encodeURIComponent("/portal/");
  }

  function logout() {
    setToken("");
    state.user = null;
    state.roles = [];
    state.permissions = [];
    state.assets = [];
    state.awsAccounts = [];
    state.awsSyncRuns = [];
    state.awsSyncStatus = null;
    state.oidcSettings = null;
    state.iamUsers = [];
    state.iamRoles = [];
    state.selectedUserID = "";
    state.selectedUserIdentity = null;
    state.activity = [];
    renderActivity();
    renderShell();
    toast("Signed out", "success");
  }

  function bindEvents() {
    elements.localLoginForm.addEventListener("submit", localLogin);
    elements.oidcLoginBtn.addEventListener("click", oidcLogin);
    elements.logoutBtn.addEventListener("click", logout);
    if (elements.themeToggleBtn) {
      elements.themeToggleBtn.addEventListener("click", toggleTheme);
    }

    elements.navItems.forEach((item) => {
      item.addEventListener("click", () => setView(item.dataset.view || "overview"));
    });

    elements.refreshOverviewBtn.addEventListener("click", async () => {
      await refreshHealth();
      await Promise.all([refreshAssets(), refreshAwsAccounts()]);
    });

    elements.refreshAssetsBtn.addEventListener("click", refreshAssets);

    let searchDebounce;
    elements.assetSearch.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.assetQuery.q = elements.assetSearch.value.trim();
        state.assetQuery.offset = 0;
        refreshAssets();
      }, 250);
    });
    const onFilterChange = (field) => (event) => {
      state.assetQuery[field] = event.target.value;
      state.assetQuery.offset = 0;
      refreshAssets();
    };
    elements.filterEnv.addEventListener("change", onFilterChange("env"));
    elements.filterType.addEventListener("change", onFilterChange("type"));
    elements.filterStatus.addEventListener("change", onFilterChange("status"));
    elements.filterSource.addEventListener("change", onFilterChange("source"));
    elements.filterRegion.addEventListener("change", onFilterChange("region"));
    elements.filterResetBtn.addEventListener("click", () => {
      state.assetQuery = { env: "", type: "", status: "", source: "", region: "", criticality: "", q: "", limit: state.assetQuery.limit, offset: 0, includeBastions: false };
      elements.assetSearch.value = "";
      const incBtn = document.getElementById("filter-include-bastions");
      if (incBtn) {
        incBtn.dataset.on = "0";
        incBtn.classList.remove("active");
      }
      refreshAssets();
    });
    const includeBastionsBtn = document.getElementById("filter-include-bastions");
    if (includeBastionsBtn) {
      includeBastionsBtn.addEventListener("click", () => {
        const next = includeBastionsBtn.dataset.on !== "1";
        includeBastionsBtn.dataset.on = next ? "1" : "0";
        includeBastionsBtn.classList.toggle("active", next);
        state.assetQuery.includeBastions = next;
        state.assetQuery.offset = 0;
        refreshAssets();
      });
    }
    elements.assetsPagination.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-page]");
      if (!btn || btn.disabled) return;
      const dir = btn.dataset.page;
      const { limit, offset } = state.assetQuery;
      state.assetQuery.offset = dir === "prev" ? Math.max(0, offset - limit) : offset + limit;
      refreshAssets();
    });

    elements.assetsTableBody.addEventListener("click", (event) => {
      const connectBtn = event.target.closest("button[data-connect-asset]");
      if (connectBtn) {
        event.stopPropagation();
        connectAssetFromList(connectBtn.dataset.connectAsset);
        return;
      }
      const row = event.target.closest("tr[data-asset-id]");
      if (!row) return;
      openAssetDrawer(row.dataset.assetId);
    });

    if (elements.assetsViewToggle) {
      elements.assetsViewToggle.addEventListener("click", (event) => {
        const btn = event.target.closest(".view-toggle-btn[data-view-mode]");
        if (!btn) return;
        const mode = btn.dataset.viewMode === "tree" ? "tree" : "list";
        if (state.assetViewMode === mode) return;
        state.assetViewMode = mode;
        try { localStorage.setItem("ops_platform_asset_view_mode", mode); } catch (_) {}
        if (mode === "tree") {
          state.assetQuery.offset = 0;
        }
        refreshAssets();
      });
    }

    if (elements.assetsTree) {
      elements.assetsTree.addEventListener("click", (event) => {
        const node = event.target.closest(".tree-node[data-asset-id]");
        if (!node) return;
        event.preventDefault();
        event.stopPropagation();
        openAssetDrawer(node.dataset.assetId);
      });
      elements.assetsTree.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const node = event.target.closest(".tree-node[data-asset-id]");
        if (!node) return;
        event.preventDefault();
        openAssetDrawer(node.dataset.assetId);
      });
      elements.assetsTree.addEventListener("toggle", (event) => {
        const det = event.target;
        if (!(det instanceof HTMLElement) || det.tagName !== "DETAILS") return;
        const key = det.dataset.treeKey;
        if (!key) return;
        state.treeExpanded[key] = det.open;
      }, true);
    }

    elements.assetDrawer.addEventListener("click", (event) => {
      if (event.target.closest("[data-drawer-close]")) closeAssetDrawer();
    });

    elements.toggleAssetFormBtn.addEventListener("click", openCreateAssetModal);

    elements.refreshAwsBtn.addEventListener("click", refreshAwsAccounts);
    elements.toggleAwsFormBtn.addEventListener("click", openCreateAwsAccountModal);
    bindSyncRunsFilter();
    elements.triggerAwsSyncBtn.addEventListener("click", triggerAwsSync);
    elements.refreshSyncBtn.addEventListener("click", async () => {
      await refreshAwsSyncStatus();
      await refreshAwsSyncRuns();
    });

    elements.refreshIamUsersBtn.addEventListener("click", refreshIAMUsers);
    elements.refreshIamRolesBtn.addEventListener("click", refreshIAMRoles);
    elements.refreshIamSelectionBtn.addEventListener("click", refreshSelectedUserIdentity);
    elements.iamBindRoleBtn.addEventListener("click", bindRoleToSelectedUser);
    elements.refreshOIDCSettingsBtn.addEventListener("click", refreshOIDCSettings);
    elements.testOIDCSettingsBtn.addEventListener("click", testOIDCSettings);
    elements.oidcSettingsForm.addEventListener("submit", saveOIDCSettings);

    elements.iamUserSearch.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        refreshIAMUsers();
      }
    });

    elements.iamUsersTableBody.addEventListener("click", (event) => {
      const button = event.target.closest(".iam-select-user-btn");
      if (!button) return;
      state.selectedUserID = button.dataset.userId || "";
      refreshSelectedUserIdentity();
    });

    elements.iamRolesTableBody.addEventListener("click", (event) => {
      const row = event.target.closest(".iam-view-role-btn");
      if (!row) return;
      const roleName = row.dataset.roleName || "";
      if (!roleName) return;
      viewRolePermissions(roleName);
    });

    elements.iamUserRoles.addEventListener("click", (event) => {
      const button = event.target.closest(".iam-unbind-role-btn");
      if (!button) return;
      const roleName = button.dataset.roleName || "";
      if (!roleName) return;
      unbindRoleFromSelectedUser(roleName);
    });

    elements.refreshProfileBtn.addEventListener("click", async () => {
      const ok = await refreshProfile();
      if (ok) await loadAuthorizedData();
    });

    bindLiveSessionsEvents();
    bindSessionsSidebarEvents();
    bindBastionsEvents();
    bindConnectivityTabs();
  }

  async function bootstrap() {
    bindEvents();
    syncThemeIcon();

    // Initial route from the URL hash so deep links (and back/forward) work.
    // Falls back to "overview" when no hash is present.
    const initial = parseHashRoute();
    setView(initial.section, initial.subsection);

    window.addEventListener("hashchange", () => {
      const r = parseHashRoute();
      setView(r.section, r.subsection);
    });

    renderShell();
    renderLiveEmptyState();

    await refreshHealth();
    const ok = await refreshProfile();
    if (ok) await loadAuthorizedData();
  }


bootstrap();
