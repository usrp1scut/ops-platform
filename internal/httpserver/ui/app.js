(function () {
  const TOKEN_KEY = "ops_platform_access_token";
  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: null,
    roles: [],
    permissions: [],
    assets: [],
    awsAccounts: [],
    view: "overview",
    activity: [],
  };

  const elements = {
    navMenu: document.getElementById("nav-menu"),
    pageTitle: document.getElementById("page-title"),
    currentUser: document.getElementById("current-user"),
    tokenInput: document.getElementById("token-input"),
    authStatus: document.getElementById("auth-status"),
    permissionBadges: document.getElementById("permission-badges"),
    consoleOutput: document.getElementById("console-output"),
    overviewHealth: document.getElementById("overview-health"),
    overviewActivity: document.getElementById("overview-activity"),
    statAssets: document.getElementById("stat-assets"),
    statAccounts: document.getElementById("stat-accounts"),
    statRoles: document.getElementById("stat-roles"),
    statWriteAccess: document.getElementById("stat-write-access"),
    assetsTableBody: document.getElementById("assets-table-body"),
    awsTableBody: document.getElementById("aws-table-body"),
    assetSearch: document.getElementById("asset-search"),
    assetForm: document.getElementById("asset-form"),
    awsForm: document.getElementById("aws-form"),
  };

  function pretty(value) {
    return JSON.stringify(value, null, 2);
  }

  function logActivity(message) {
    const line = new Date().toLocaleTimeString() + "  " + message;
    state.activity.unshift(line);
    state.activity = state.activity.slice(0, 12);
    elements.overviewActivity.textContent = state.activity.join("\n");
  }

  function writeConsole(value, ok) {
    elements.consoleOutput.textContent = typeof value === "string" ? value : pretty(value);
    elements.consoleOutput.classList.remove("is-ok", "is-error");
    elements.consoleOutput.classList.add(ok ? "is-ok" : "is-error");
  }

  function saveToken(value) {
    state.token = value;
    if (value) {
      localStorage.setItem(TOKEN_KEY, value);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    elements.tokenInput.value = value;
  }

  function hasPermission(permission) {
    return state.permissions.includes(permission) || state.permissions.includes("system:admin");
  }

  function setView(view) {
    state.view = view;
    const titles = {
      overview: "Overview",
      cmdb: "CMDB",
      aws: "AWS Accounts",
      alerts: "Alerts",
      bastion: "Bastion",
    };
    elements.pageTitle.textContent = titles[view] || "Overview";

    document.querySelectorAll(".nav-item").forEach(function (item) {
      item.classList.toggle("active", item.dataset.view === view);
    });
    document.querySelectorAll(".view").forEach(function (node) {
      node.classList.toggle("active", node.id === "view-" + view);
    });
  }

  function renderPermissions() {
    elements.permissionBadges.innerHTML = "";
    state.roles.forEach(function (role) {
      const badge = document.createElement("span");
      badge.className = "badge role";
      badge.textContent = role;
      elements.permissionBadges.appendChild(badge);
    });
    state.permissions.slice(0, 4).forEach(function (permission) {
      const badge = document.createElement("span");
      badge.className = "badge perm";
      badge.textContent = permission;
      elements.permissionBadges.appendChild(badge);
    });
  }

  function renderStats() {
    elements.statAssets.textContent = String(state.assets.length);
    elements.statAccounts.textContent = String(state.awsAccounts.length);
    elements.statRoles.textContent = String(state.roles.length);
    elements.statWriteAccess.textContent =
      hasPermission("cmdb.asset:write") || hasPermission("aws.account:write") ? "Yes" : "No";
  }

  function renderAuthState() {
    if (!state.user) {
      elements.currentUser.textContent = "Guest";
      elements.authStatus.textContent = state.token ? "Token loaded, profile unresolved" : "No active session";
    } else {
      elements.currentUser.textContent = state.user.name || state.user.email || state.user.oidc_subject || "User";
      elements.authStatus.textContent =
        "Logged in as " + (state.user.email || state.user.oidc_subject || state.user.id);
    }
    renderPermissions();
    renderStats();
  }

  function renderAssetTable() {
    const keyword = (elements.assetSearch.value || "").trim().toLowerCase();
    const rows = state.assets.filter(function (asset) {
      if (!keyword) {
        return true;
      }
      return (
        String(asset.name || "").toLowerCase().includes(keyword) ||
        String(asset.external_id || "").toLowerCase().includes(keyword)
      );
    });

    elements.assetsTableBody.innerHTML = "";
    if (rows.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">No asset records</td>';
      elements.assetsTableBody.appendChild(row);
      return;
    }

    rows.forEach(function (asset) {
      const row = document.createElement("tr");
      row.innerHTML =
        "<td>" +
        safe(asset.name) +
        "</td><td>" +
        safe(asset.type) +
        "</td><td>" +
        safe(asset.env || "default") +
        "</td><td>" +
        safe(asset.status || "active") +
        "</td><td>" +
        safe(asset.source || "") +
        "</td><td>" +
        safe(asset.external_id || "") +
        "</td>";
      elements.assetsTableBody.appendChild(row);
    });
  }

  function renderAwsTable() {
    elements.awsTableBody.innerHTML = "";
    if (state.awsAccounts.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">No AWS account records</td>';
      elements.awsTableBody.appendChild(row);
      return;
    }

    state.awsAccounts.forEach(function (item) {
      const row = document.createElement("tr");
      row.innerHTML =
        "<td>" +
        safe(item.account_id) +
        "</td><td>" +
        safe(item.display_name) +
        "</td><td>" +
        safe(item.auth_mode) +
        "</td><td>" +
        safe(item.role_arn || "") +
        "</td><td>" +
        safe((item.region_allowlist || []).join(", ")) +
        "</td><td>" +
        (item.enabled ? "true" : "false") +
        "</td>";
      elements.awsTableBody.appendChild(row);
    });
  }

  function applyPermissionUI() {
    const canAssetWrite = hasPermission("cmdb.asset:write");
    const canAwsWrite = hasPermission("aws.account:write");
    elements.assetForm.querySelectorAll("input,button,select,textarea").forEach(function (el) {
      el.disabled = !canAssetWrite;
    });
    elements.awsForm.querySelectorAll("input,button,select,textarea").forEach(function (el) {
      el.disabled = !canAwsWrite;
    });
  }

  async function api(path, options) {
    const headers = Object.assign(
      {
        "Content-Type": "application/json",
      },
      options && options.headers ? options.headers : {}
    );
    if (state.token) {
      headers.Authorization = "Bearer " + state.token;
    }

    const response = await fetch(path, {
      method: "GET",
      ...options,
      headers,
    });

    const text = await response.text();
    let payload = text;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (parseError) {
      payload = text;
    }

    if (!response.ok) {
      const message = typeof payload === "string" ? payload : pretty(payload);
      throw new Error(message);
    }
    return payload;
  }

  function parseRegions(csv) {
    if (!csv || !csv.trim()) {
      return [];
    }
    return csv
      .split(",")
      .map(function (item) {
        return item.trim();
      })
      .filter(Boolean);
  }

  async function refreshHealth() {
    try {
      const health = await api("/healthz");
      elements.overviewHealth.textContent = pretty(health);
      logActivity("Health check succeeded.");
    } catch (error) {
      elements.overviewHealth.textContent = error.message;
      logActivity("Health check failed.");
    }
  }

  async function refreshProfile() {
    if (!state.token) {
      state.user = null;
      state.roles = [];
      state.permissions = [];
      renderAuthState();
      applyPermissionUI();
      writeConsole("Missing token. Use OIDC login or paste token manually.", false);
      return;
    }

    try {
      const data = await api("/auth/me");
      state.user = data.user || null;
      state.roles = data.roles || [];
      state.permissions = data.permissions || [];
      renderAuthState();
      applyPermissionUI();
      writeConsole(data, true);
      logActivity("Profile refreshed.");
    } catch (error) {
      state.user = null;
      state.roles = [];
      state.permissions = [];
      renderAuthState();
      applyPermissionUI();
      writeConsole(error.message, false);
      logActivity("Profile refresh failed.");
    }
  }

  async function refreshAssets() {
    try {
      const data = await api("/api/v1/cmdb/assets");
      state.assets = data.items || [];
      renderAssetTable();
      renderStats();
      logActivity("Asset list refreshed (" + state.assets.length + ").");
    } catch (error) {
      state.assets = [];
      renderAssetTable();
      renderStats();
      writeConsole(error.message, false);
      logActivity("Asset refresh failed.");
    }
  }

  async function refreshAwsAccounts() {
    try {
      const data = await api("/api/v1/aws/accounts");
      state.awsAccounts = data.items || [];
      renderAwsTable();
      renderStats();
      logActivity("AWS account list refreshed (" + state.awsAccounts.length + ").");
    } catch (error) {
      state.awsAccounts = [];
      renderAwsTable();
      renderStats();
      writeConsole(error.message, false);
      logActivity("AWS account refresh failed.");
    }
  }

  async function createAsset(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const body = {
      name: String(form.get("name") || "").trim(),
      type: String(form.get("type") || "").trim(),
      env: String(form.get("env") || "").trim() || "default",
      status: String(form.get("status") || "").trim() || "active",
      source: String(form.get("source") || "").trim() || "manual",
      external_id: String(form.get("external_id") || "").trim(),
    };

    try {
      const created = await api("/api/v1/cmdb/assets", {
        method: "POST",
        body: JSON.stringify(body),
      });
      writeConsole({ created_asset: created }, true);
      event.target.reset();
      await refreshAssets();
      logActivity("Asset created: " + body.name);
    } catch (error) {
      writeConsole(error.message, false);
      logActivity("Asset create failed.");
    }
  }

  async function createAwsAccount(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const authMode = String(form.get("auth_mode") || "assume_role");
    const body = {
      account_id: String(form.get("account_id") || "").trim(),
      display_name: String(form.get("display_name") || "").trim(),
      auth_mode: authMode,
      role_arn: String(form.get("role_arn") || "").trim(),
      access_key_id: String(form.get("access_key_id") || "").trim(),
      secret_access_key: String(form.get("secret_access_key") || "").trim(),
      external_id: String(form.get("external_id") || "").trim(),
      region_allowlist: parseRegions(String(form.get("region_allowlist") || "")),
      enabled: true,
    };
    try {
      const created = await api("/api/v1/aws/accounts", {
        method: "POST",
        body: JSON.stringify(body),
      });
      writeConsole({ created_aws_account: created }, true);
      event.target.reset();
      await refreshAwsAccounts();
      logActivity("AWS account created: " + body.account_id);
    } catch (error) {
      writeConsole(error.message, false);
      logActivity("AWS account create failed.");
    }
  }

  function bindEvents() {
    elements.navMenu.addEventListener("click", function (event) {
      const button = event.target.closest(".nav-item");
      if (!button) {
        return;
      }
      setView(button.dataset.view || "overview");
    });

    document.getElementById("oidc-login-btn").addEventListener("click", function () {
      window.location.href = "/auth/oidc/login";
    });

    document.getElementById("auth-refresh-btn").addEventListener("click", refreshProfile);
    document.getElementById("refresh-overview-btn").addEventListener("click", refreshHealth);
    document.getElementById("refresh-assets-btn").addEventListener("click", refreshAssets);
    document.getElementById("refresh-aws-btn").addEventListener("click", refreshAwsAccounts);
    document.getElementById("save-token-btn").addEventListener("click", function () {
      const value = elements.tokenInput.value.trim();
      saveToken(value);
      logActivity(value ? "Token updated." : "Token emptied.");
      refreshProfile();
    });
    document.getElementById("clear-token-btn").addEventListener("click", function () {
      saveToken("");
      state.user = null;
      state.roles = [];
      state.permissions = [];
      renderAuthState();
      applyPermissionUI();
      logActivity("Token cleared.");
    });

    elements.assetSearch.addEventListener("input", renderAssetTable);
    elements.assetForm.addEventListener("submit", createAsset);
    elements.awsForm.addEventListener("submit", createAwsAccount);
  }

  function safe(input) {
    return String(input == null ? "" : input)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  async function bootstrap() {
    bindEvents();
    elements.tokenInput.value = state.token;
    setView("overview");
    renderAuthState();
    renderAssetTable();
    renderAwsTable();
    applyPermissionUI();

    await refreshHealth();
    await refreshProfile();
    if (state.token) {
      await Promise.all([refreshAssets(), refreshAwsAccounts()]);
    }
  }

  bootstrap();
})();
