(function () {
  const TOKEN_KEY = "ops_platform_access_token";

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: null,
    roles: [],
    permissions: [],
    assets: [],
    awsAccounts: [],
    iamUsers: [],
    iamRoles: [],
    selectedUserID: "",
    selectedUserIdentity: null,
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
    iamUserSearch: document.getElementById("iam-user-search"),
    iamUsersTableBody: document.getElementById("iam-users-table-body"),
    iamRolesTableBody: document.getElementById("iam-roles-table-body"),
    iamSelectedUser: document.getElementById("iam-selected-user"),
    iamRoleSelect: document.getElementById("iam-role-select"),
    iamUserRoles: document.getElementById("iam-user-roles"),
    iamRolePermissionsOutput: document.getElementById("iam-role-permissions-output"),
    refreshIamUsersBtn: document.getElementById("refresh-iam-users-btn"),
    refreshIamRolesBtn: document.getElementById("refresh-iam-roles-btn"),
    refreshIamSelectionBtn: document.getElementById("refresh-iam-selection-btn"),
    iamBindRoleBtn: document.getElementById("iam-bind-role-btn"),
  };

  function pretty(value) {
    return JSON.stringify(value, null, 2);
  }

  function safe(input) {
    return String(input == null ? "" : input)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function hasPermission(permission) {
    return state.permissions.includes(permission) || state.permissions.includes("system:admin");
  }

  function canReadIAM() {
    return hasPermission("iam.user:read");
  }

  function canWriteIAM() {
    return hasPermission("iam.user:write");
  }

  function writeConsole(value, ok) {
    elements.consoleOutput.textContent = typeof value === "string" ? value : pretty(value);
    elements.consoleOutput.classList.remove("is-ok", "is-error");
    elements.consoleOutput.classList.add(ok ? "is-ok" : "is-error");
  }

  function logActivity(message) {
    const line = new Date().toLocaleTimeString() + "  " + message;
    state.activity.unshift(line);
    state.activity = state.activity.slice(0, 14);
    elements.overviewActivity.textContent = state.activity.join("\n");
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

  function setView(view) {
    state.view = view;
    const titles = {
      overview: "Overview",
      cmdb: "CMDB",
      aws: "AWS Accounts",
      iam: "IAM",
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
    state.permissions.slice(0, 6).forEach(function (permission) {
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
      hasPermission("cmdb.asset:write") || hasPermission("aws.account:write") || canWriteIAM() ? "Yes" : "No";
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

  function renderIAMUserTable() {
    elements.iamUsersTableBody.innerHTML = "";

    if (!canReadIAM()) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="5">Permission required: iam.user:read</td>';
      elements.iamUsersTableBody.appendChild(row);
      return;
    }

    if (state.iamUsers.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="5">No users found</td>';
      elements.iamUsersTableBody.appendChild(row);
      return;
    }

    state.iamUsers.forEach(function (item) {
      const selectedMark = item.id === state.selectedUserID ? " (selected)" : "";
      const row = document.createElement("tr");
      row.innerHTML =
        "<td>" +
        safe(item.name || item.oidc_subject) +
        selectedMark +
        "</td><td>" +
        safe(item.email || "-") +
        "</td><td>" +
        safe(item.oidc_subject) +
        "</td><td>" +
        safe((item.roles || []).join(", ") || "-") +
        "</td><td><button class=\"btn subtle small iam-select-user-btn\" data-user-id=\"" +
        safe(item.id) +
        "\">Select</button></td>";
      elements.iamUsersTableBody.appendChild(row);
    });
  }

  function renderIAMRolesTable() {
    elements.iamRolesTableBody.innerHTML = "";

    if (!canReadIAM()) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="4">Permission required: iam.user:read</td>';
      elements.iamRolesTableBody.appendChild(row);
      return;
    }

    if (state.iamRoles.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="4">No roles found</td>';
      elements.iamRolesTableBody.appendChild(row);
      return;
    }

    state.iamRoles.forEach(function (role) {
      const row = document.createElement("tr");
      row.innerHTML =
        "<td>" +
        safe(role.name) +
        "</td><td>" +
        safe(role.description || "-") +
        "</td><td>" +
        String((role.permissions || []).length) +
        "</td><td><button class=\"btn subtle small iam-view-role-btn\" data-role-name=\"" +
        safe(role.name) +
        "\">View</button></td>";
      elements.iamRolesTableBody.appendChild(row);
    });
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

    state.iamRoles.forEach(function (role) {
      const option = document.createElement("option");
      option.value = role.name;
      option.textContent = role.name;
      elements.iamRoleSelect.appendChild(option);
    });
  }

  function renderIAMSelectedUser() {
    if (!state.selectedUserIdentity) {
      elements.iamSelectedUser.textContent = "No user selected.";
      elements.iamUserRoles.innerHTML = "";
      return;
    }

    const identity = state.selectedUserIdentity;
    elements.iamSelectedUser.textContent = pretty({
      id: identity.user.id,
      name: identity.user.name,
      email: identity.user.email,
      oidc_subject: identity.user.oidc_subject,
      roles: identity.roles,
      permissions_count: (identity.permissions || []).length,
    });

    elements.iamUserRoles.innerHTML = "";
    if (!identity.roles || identity.roles.length === 0) {
      const span = document.createElement("span");
      span.className = "muted";
      span.textContent = "No role bindings";
      elements.iamUserRoles.appendChild(span);
      return;
    }

    identity.roles.forEach(function (roleName) {
      const chip = document.createElement("span");
      chip.className = "role-chip";
      chip.innerHTML = "<span>" + safe(roleName) + "</span>";
      if (canWriteIAM()) {
        const button = document.createElement("button");
        button.className = "iam-unbind-role-btn";
        button.dataset.roleName = roleName;
        button.textContent = "Unbind";
        chip.appendChild(button);
      }
      elements.iamUserRoles.appendChild(chip);
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

    const disableIAMRead = !canReadIAM();
    const disableIAMWrite = !canWriteIAM();
    elements.refreshIamUsersBtn.disabled = disableIAMRead;
    elements.refreshIamRolesBtn.disabled = disableIAMRead;
    elements.refreshIamSelectionBtn.disabled = disableIAMRead;
    elements.iamUserSearch.disabled = disableIAMRead;
    elements.iamRoleSelect.disabled = disableIAMRead || disableIAMWrite;
    elements.iamBindRoleBtn.disabled = disableIAMRead || disableIAMWrite || !state.selectedUserID;
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
      return false;
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
      return true;
    } catch (error) {
      state.user = null;
      state.roles = [];
      state.permissions = [];
      renderAuthState();
      applyPermissionUI();
      writeConsole(error.message, false);
      logActivity("Profile refresh failed.");
      return false;
    }
  }

  async function refreshAssets() {
    if (!hasPermission("cmdb.asset:read")) {
      state.assets = [];
      renderAssetTable();
      renderStats();
      return;
    }
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
    if (!hasPermission("aws.account:read")) {
      state.awsAccounts = [];
      renderAwsTable();
      renderStats();
      return;
    }
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

  async function refreshIAMUsers() {
    if (!canReadIAM()) {
      state.iamUsers = [];
      renderIAMUserTable();
      renderIAMSelectedUser();
      return;
    }
    try {
      const query = (elements.iamUserSearch.value || "").trim();
      const path = query ? "/api/v1/iam/users?q=" + encodeURIComponent(query) : "/api/v1/iam/users";
      const data = await api(path);
      state.iamUsers = data.items || [];
      renderIAMUserTable();
      logActivity("IAM users refreshed (" + state.iamUsers.length + ").");
    } catch (error) {
      state.iamUsers = [];
      renderIAMUserTable();
      writeConsole(error.message, false);
      logActivity("IAM users refresh failed.");
    }
  }

  async function refreshIAMRoles() {
    if (!canReadIAM()) {
      state.iamRoles = [];
      renderIAMRolesTable();
      populateIAMRoleSelect();
      return;
    }
    try {
      const data = await api("/api/v1/iam/roles?include_permissions=true");
      state.iamRoles = data.items || [];
      renderIAMRolesTable();
      populateIAMRoleSelect();
      logActivity("IAM roles refreshed (" + state.iamRoles.length + ").");
    } catch (error) {
      state.iamRoles = [];
      renderIAMRolesTable();
      populateIAMRoleSelect();
      writeConsole(error.message, false);
      logActivity("IAM roles refresh failed.");
    }
  }

  async function refreshSelectedUserIdentity() {
    if (!state.selectedUserID || !canReadIAM()) {
      state.selectedUserIdentity = null;
      renderIAMSelectedUser();
      applyPermissionUI();
      return;
    }
    try {
      const identity = await api("/api/v1/iam/users/" + encodeURIComponent(state.selectedUserID));
      state.selectedUserIdentity = identity;
      renderIAMSelectedUser();
      syncSelectedUserRolesToList();
      applyPermissionUI();
      logActivity("Selected user access refreshed.");
    } catch (error) {
      state.selectedUserIdentity = null;
      renderIAMSelectedUser();
      applyPermissionUI();
      writeConsole(error.message, false);
      logActivity("Selected user refresh failed.");
    }
  }

  function syncSelectedUserRolesToList() {
    if (!state.selectedUserIdentity) {
      return;
    }
    state.iamUsers = state.iamUsers.map(function (item) {
      if (item.id !== state.selectedUserID) {
        return item;
      }
      return Object.assign({}, item, { roles: state.selectedUserIdentity.roles || [] });
    });
    renderIAMUserTable();
  }

  async function viewRolePermissions(roleName) {
    if (!canReadIAM()) {
      writeConsole("Permission required: iam.user:read", false);
      return;
    }
    try {
      const data = await api("/api/v1/iam/roles/" + encodeURIComponent(roleName) + "/permissions");
      elements.iamRolePermissionsOutput.textContent = pretty(data);
      logActivity("Viewed permissions for role " + roleName + ".");
    } catch (error) {
      elements.iamRolePermissionsOutput.textContent = error.message;
      writeConsole(error.message, false);
      logActivity("Role permission query failed.");
    }
  }

  async function bindRoleToSelectedUser() {
    if (!state.selectedUserID) {
      writeConsole("Select a user first.", false);
      return;
    }
    if (!canWriteIAM()) {
      writeConsole("Permission required: iam.user:write", false);
      return;
    }
    const roleName = (elements.iamRoleSelect.value || "").trim();
    if (!roleName) {
      writeConsole("Select a role first.", false);
      return;
    }
    try {
      const identity = await api("/api/v1/iam/users/" + encodeURIComponent(state.selectedUserID) + "/roles", {
        method: "POST",
        body: JSON.stringify({ role_name: roleName }),
      });
      state.selectedUserIdentity = identity;
      renderIAMSelectedUser();
      syncSelectedUserRolesToList();
      writeConsole(identity, true);
      logActivity("Bound role " + roleName + " to selected user.");
    } catch (error) {
      writeConsole(error.message, false);
      logActivity("Bind role failed.");
    }
  }

  async function unbindRoleFromSelectedUser(roleName) {
    if (!state.selectedUserID) {
      writeConsole("Select a user first.", false);
      return;
    }
    if (!canWriteIAM()) {
      writeConsole("Permission required: iam.user:write", false);
      return;
    }
    try {
      const identity = await api(
        "/api/v1/iam/users/" +
          encodeURIComponent(state.selectedUserID) +
          "/roles/" +
          encodeURIComponent(roleName),
        { method: "DELETE" }
      );
      state.selectedUserIdentity = identity;
      renderIAMSelectedUser();
      syncSelectedUserRolesToList();
      writeConsole(identity, true);
      logActivity("Unbound role " + roleName + " from selected user.");
    } catch (error) {
      writeConsole(error.message, false);
      logActivity("Unbind role failed.");
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

  async function loadAuthorizedData() {
    await Promise.all([refreshAssets(), refreshAwsAccounts(), refreshIAMRoles(), refreshIAMUsers()]);
    await refreshSelectedUserIdentity();
    applyPermissionUI();
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

    document.getElementById("auth-refresh-btn").addEventListener("click", async function () {
      const ok = await refreshProfile();
      if (ok) {
        await loadAuthorizedData();
      }
    });

    document.getElementById("refresh-overview-btn").addEventListener("click", refreshHealth);
    document.getElementById("refresh-assets-btn").addEventListener("click", refreshAssets);
    document.getElementById("refresh-aws-btn").addEventListener("click", refreshAwsAccounts);
    elements.refreshIamUsersBtn.addEventListener("click", refreshIAMUsers);
    elements.refreshIamRolesBtn.addEventListener("click", refreshIAMRoles);
    elements.refreshIamSelectionBtn.addEventListener("click", refreshSelectedUserIdentity);
    elements.iamBindRoleBtn.addEventListener("click", bindRoleToSelectedUser);

    document.getElementById("save-token-btn").addEventListener("click", async function () {
      const value = elements.tokenInput.value.trim();
      saveToken(value);
      logActivity(value ? "Token updated." : "Token emptied.");
      const ok = await refreshProfile();
      if (ok) {
        await loadAuthorizedData();
      }
    });

    document.getElementById("clear-token-btn").addEventListener("click", function () {
      saveToken("");
      state.user = null;
      state.roles = [];
      state.permissions = [];
      state.assets = [];
      state.awsAccounts = [];
      state.iamUsers = [];
      state.iamRoles = [];
      state.selectedUserID = "";
      state.selectedUserIdentity = null;
      renderAuthState();
      renderAssetTable();
      renderAwsTable();
      renderIAMUserTable();
      renderIAMRolesTable();
      renderIAMSelectedUser();
      populateIAMRoleSelect();
      applyPermissionUI();
      logActivity("Token cleared.");
    });

    elements.assetSearch.addEventListener("input", renderAssetTable);
    elements.assetForm.addEventListener("submit", createAsset);
    elements.awsForm.addEventListener("submit", createAwsAccount);

    elements.iamUserSearch.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        refreshIAMUsers();
      }
    });

    elements.iamUsersTableBody.addEventListener("click", function (event) {
      const button = event.target.closest(".iam-select-user-btn");
      if (!button) {
        return;
      }
      state.selectedUserID = button.dataset.userId || "";
      refreshSelectedUserIdentity();
    });

    elements.iamRolesTableBody.addEventListener("click", function (event) {
      const button = event.target.closest(".iam-view-role-btn");
      if (!button) {
        return;
      }
      const roleName = button.dataset.roleName || "";
      if (!roleName) {
        return;
      }
      viewRolePermissions(roleName);
    });

    elements.iamUserRoles.addEventListener("click", function (event) {
      const button = event.target.closest(".iam-unbind-role-btn");
      if (!button) {
        return;
      }
      const roleName = button.dataset.roleName || "";
      if (!roleName) {
        return;
      }
      unbindRoleFromSelectedUser(roleName);
    });
  }

  async function bootstrap() {
    bindEvents();
    elements.tokenInput.value = state.token;
    setView("overview");
    renderAuthState();
    renderAssetTable();
    renderAwsTable();
    renderIAMUserTable();
    renderIAMRolesTable();
    renderIAMSelectedUser();
    populateIAMRoleSelect();
    applyPermissionUI();
    elements.iamRolePermissionsOutput.textContent = "Select a role to view permissions.";

    await refreshHealth();
    const ok = await refreshProfile();
    if (ok) {
      await loadAuthorizedData();
    }
  }

  bootstrap();
})();
