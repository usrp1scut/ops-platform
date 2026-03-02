(function () {
  const TOKEN_KEY = "ops_platform_access_token";

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: null,
    roles: [],
    permissions: [],
    assets: [],
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
  };

  const elements = {
    authGate: document.getElementById("auth-gate"),
    workspace: document.getElementById("workspace"),
    userBadge: document.getElementById("user-badge"),
    logoutBtn: document.getElementById("logout-btn"),
    authOutput: document.getElementById("auth-output"),
    localLoginForm: document.getElementById("local-login-form"),
    localUsername: document.getElementById("local-username"),
    localPassword: document.getElementById("local-password"),
    oidcLoginBtn: document.getElementById("oidc-login-btn"),

    navItems: document.querySelectorAll(".nav-item"),
    views: document.querySelectorAll(".view"),

    metricAssets: document.getElementById("metric-assets"),
    metricAccounts: document.getElementById("metric-accounts"),
    metricRoles: document.getElementById("metric-roles"),
    metricWrite: document.getElementById("metric-write"),

    refreshOverviewBtn: document.getElementById("refresh-overview-btn"),
    healthOutput: document.getElementById("health-output"),
    activityOutput: document.getElementById("activity-output"),

    assetSearch: document.getElementById("asset-search"),
    refreshAssetsBtn: document.getElementById("refresh-assets-btn"),
    assetsTableBody: document.getElementById("assets-table-body"),
    assetForm: document.getElementById("asset-form"),

    refreshAwsBtn: document.getElementById("refresh-aws-btn"),
    cloudAccountsBody: document.getElementById("cloud-accounts-body"),
    awsForm: document.getElementById("aws-form"),
    triggerAwsSyncBtn: document.getElementById("trigger-aws-sync-btn"),
    refreshSyncBtn: document.getElementById("refresh-sync-btn"),
    syncStatusOutput: document.getElementById("sync-status-output"),
    syncRunsBody: document.getElementById("sync-runs-body"),

    iamUserSearch: document.getElementById("iam-user-search"),
    refreshIamUsersBtn: document.getElementById("refresh-iam-users-btn"),
    iamUsersTableBody: document.getElementById("iam-users-table-body"),
    refreshIamSelectionBtn: document.getElementById("refresh-iam-selection-btn"),
    iamSelectedUser: document.getElementById("iam-selected-user"),
    iamRoleSelect: document.getElementById("iam-role-select"),
    iamBindRoleBtn: document.getElementById("iam-bind-role-btn"),
    iamUserRoles: document.getElementById("iam-user-roles"),
    refreshIamRolesBtn: document.getElementById("refresh-iam-roles-btn"),
    iamRolesTableBody: document.getElementById("iam-roles-table-body"),
    iamRolePermissionsOutput: document.getElementById("iam-role-permissions-output"),

    refreshOIDCSettingsBtn: document.getElementById("refresh-oidc-settings-btn"),
    oidcSettingsForm: document.getElementById("oidc-settings-form"),
    oidcEnabledInput: document.getElementById("oidc-enabled-input"),
    oidcIssuerURLInput: document.getElementById("oidc-issuer-url-input"),
    oidcClientIDInput: document.getElementById("oidc-client-id-input"),
    oidcClientSecretInput: document.getElementById("oidc-client-secret-input"),
    oidcRedirectURLInput: document.getElementById("oidc-redirect-url-input"),
    oidcAuthorizeURLInput: document.getElementById("oidc-authorize-url-input"),
    oidcTokenURLInput: document.getElementById("oidc-token-url-input"),
    oidcUserInfoURLInput: document.getElementById("oidc-userinfo-url-input"),
    oidcScopesInput: document.getElementById("oidc-scopes-input"),
    oidcSettingsOutput: document.getElementById("oidc-settings-output"),

    refreshProfileBtn: document.getElementById("refresh-profile-btn"),
    identityOutput: document.getElementById("identity-output"),
    permissionChips: document.getElementById("permission-chips"),
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

  function canReadIAM() {
    return hasPermission("iam.user:read");
  }

  function canWriteIAM() {
    return hasPermission("iam.user:write");
  }

  function writeAccess() {
    return hasPermission("cmdb.asset:write") || hasPermission("aws.account:write") || canWriteIAM();
  }

  function logActivity(message) {
    const line = new Date().toLocaleTimeString() + "  " + message;
    state.activity.unshift(line);
    state.activity = state.activity.slice(0, 18);
    elements.activityOutput.textContent = state.activity.join("\n");
  }

  function writeAuthOutput(content, isError) {
    elements.authOutput.textContent = typeof content === "string" ? content : pretty(content);
    elements.authOutput.style.color = isError ? "#9f2b2b" : "#21313b";
  }

  function setView(view) {
    state.view = view;
    elements.navItems.forEach(function (item) {
      item.classList.toggle("active", item.dataset.view === view);
    });
    elements.views.forEach(function (node) {
      node.classList.toggle("active", node.id === "view-" + view);
    });
  }

  function formatDateTime(value) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString();
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

  function parseScopes(csv) {
    if (!csv || !csv.trim()) {
      return ["openid", "profile", "email"];
    }
    const set = new Set();
    csv
      .split(",")
      .map(function (item) {
        return item.trim();
      })
      .filter(Boolean)
      .forEach(function (item) {
        set.add(item);
      });
    return Array.from(set);
  }

  function renderStats() {
    elements.metricAssets.textContent = String(state.assets.length);
    elements.metricAccounts.textContent = String(state.awsAccounts.length);
    elements.metricRoles.textContent = String(state.roles.length);
    elements.metricWrite.textContent = writeAccess() ? "Yes" : "No";
  }

  function renderProfile() {
    if (!state.user) {
      elements.identityOutput.textContent = "No session.";
      elements.userBadge.textContent = "Guest";
      return;
    }

    elements.userBadge.textContent = state.user.name || state.user.email || state.user.oidc_subject || "User";
    elements.identityOutput.textContent = pretty({
      user: state.user,
      roles: state.roles,
      permissions_count: state.permissions.length,
    });
  }

  function renderPermissionChips() {
    elements.permissionChips.innerHTML = "";
    if (!state.user) {
      return;
    }
    state.roles.forEach(function (role) {
      const chip = document.createElement("span");
      chip.className = "chip role";
      chip.textContent = role;
      elements.permissionChips.appendChild(chip);
    });
    state.permissions.forEach(function (permission) {
      const chip = document.createElement("span");
      chip.className = "chip perm";
      chip.textContent = permission;
      elements.permissionChips.appendChild(chip);
    });
  }

  function renderAssetTable() {
    elements.assetsTableBody.innerHTML = "";

    if (!hasPermission("cmdb.asset:read")) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">Permission required: cmdb.asset:read</td>';
      elements.assetsTableBody.appendChild(row);
      return;
    }

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

    if (rows.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">No assets found.</td>';
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

  function renderAwsAccounts() {
    elements.cloudAccountsBody.innerHTML = "";

    if (!hasPermission("aws.account:read")) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">Permission required: aws.account:read</td>';
      elements.cloudAccountsBody.appendChild(row);
      return;
    }

    if (state.awsAccounts.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">No AWS account records.</td>';
      elements.cloudAccountsBody.appendChild(row);
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
      elements.cloudAccountsBody.appendChild(row);
    });
  }

  function renderAwsSyncStatus() {
    if (!hasPermission("aws.account:read")) {
      elements.syncStatusOutput.textContent = "Permission required: aws.account:read";
      return;
    }
    if (!state.awsSyncStatus) {
      elements.syncStatusOutput.textContent = "No sync status yet.";
      return;
    }
    elements.syncStatusOutput.textContent = pretty(state.awsSyncStatus);
  }

  function renderAwsSyncRuns() {
    elements.syncRunsBody.innerHTML = "";

    if (!hasPermission("aws.account:read")) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">Permission required: aws.account:read</td>';
      elements.syncRunsBody.appendChild(row);
      return;
    }

    if (state.awsSyncRuns.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6">No sync runs.</td>';
      elements.syncRunsBody.appendChild(row);
      return;
    }

    state.awsSyncRuns.forEach(function (run) {
      const row = document.createElement("tr");
      row.innerHTML =
        "<td>" +
        safe(formatDateTime(run.started_at)) +
        "</td><td>" +
        safe((run.account_display_name || "") + " (" + (run.account_id || "") + ")") +
        "</td><td>" +
        safe(run.region || "-") +
        "</td><td>" +
        safe(run.resource_type || "-") +
        "</td><td>" +
        safe(run.status || "-") +
        "</td><td>" +
        String(run.resources_processed || 0) +
        "</td>";
      elements.syncRunsBody.appendChild(row);
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
      row.innerHTML = '<td colspan="5">No users found.</td>';
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
        safe(item.oidc_subject || "-") +
        "</td><td>" +
        safe((item.roles || []).join(", ") || "-") +
        "</td><td><button class=\"btn subtle tiny iam-select-user-btn\" data-user-id=\"" +
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
      row.innerHTML = '<td colspan="4">No roles found.</td>';
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
        "</td><td><button class=\"btn subtle tiny iam-view-role-btn\" data-role-name=\"" +
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
      chip.className = "chip role";
      chip.textContent = roleName;
      if (canWriteIAM()) {
        const button = document.createElement("button");
        button.className = "btn subtle tiny iam-unbind-role-btn";
        button.dataset.roleName = roleName;
        button.textContent = "Unbind";
        chip.appendChild(document.createTextNode(" "));
        chip.appendChild(button);
      }
      elements.iamUserRoles.appendChild(chip);
    });
  }

  function renderOIDCSettings() {
    if (!state.oidcSettings) {
      elements.oidcSettingsOutput.textContent = "OIDC config not loaded.";
      return;
    }

    const settings = state.oidcSettings;
    elements.oidcEnabledInput.checked = !!settings.enabled;
    elements.oidcIssuerURLInput.value = settings.issuer_url || "";
    elements.oidcClientIDInput.value = settings.client_id || "";
    elements.oidcClientSecretInput.value = "";
    elements.oidcRedirectURLInput.value = settings.redirect_url || "";
    elements.oidcAuthorizeURLInput.value = settings.authorize_url || "";
    elements.oidcTokenURLInput.value = settings.token_url || "";
    elements.oidcUserInfoURLInput.value = settings.userinfo_url || "";
    elements.oidcScopesInput.value = (settings.scopes || []).join(",");

    elements.oidcSettingsOutput.textContent = pretty({
      enabled: settings.enabled,
      issuer_url: settings.issuer_url,
      client_id: settings.client_id,
      has_client_secret: settings.has_client_secret,
      redirect_url: settings.redirect_url,
      authorize_url: settings.authorize_url,
      token_url: settings.token_url,
      userinfo_url: settings.userinfo_url,
      scopes: settings.scopes,
      updated_at: settings.updated_at,
    });
  }

  function renderShell() {
    const isAuthed = !!state.user;
    elements.authGate.classList.toggle("active", !isAuthed);
    elements.workspace.classList.toggle("active", isAuthed);
    elements.logoutBtn.disabled = !isAuthed;

    renderStats();
    renderProfile();
    renderPermissionChips();
    renderAssetTable();
    renderAwsAccounts();
    renderAwsSyncStatus();
    renderAwsSyncRuns();
    renderIAMUserTable();
    renderIAMRolesTable();
    renderIAMSelectedUser();
    populateIAMRoleSelect();
    renderOIDCSettings();
    applyPermissionUI();
  }

  function applyPermissionUI() {
    if (elements.assetForm) {
      const canWriteAsset = hasPermission("cmdb.asset:write");
      elements.assetForm.querySelectorAll("input,button,select,textarea").forEach(function (el) {
        el.disabled = !canWriteAsset;
      });
    }

    if (elements.awsForm) {
      const canWriteAws = hasPermission("aws.account:write");
      elements.awsForm.querySelectorAll("input,button,select,textarea").forEach(function (el) {
        el.disabled = !canWriteAws;
      });
      elements.triggerAwsSyncBtn.disabled = !canWriteAws;
    }

    const disableIAMRead = !canReadIAM();
    const disableIAMWrite = !canWriteIAM();
    elements.iamUserSearch.disabled = disableIAMRead;
    elements.refreshIamUsersBtn.disabled = disableIAMRead;
    elements.refreshIamSelectionBtn.disabled = disableIAMRead;
    elements.refreshIamRolesBtn.disabled = disableIAMRead;
    elements.refreshOIDCSettingsBtn.disabled = disableIAMRead;
    elements.iamRoleSelect.disabled = disableIAMRead || disableIAMWrite;
    elements.iamBindRoleBtn.disabled = disableIAMRead || disableIAMWrite || !state.selectedUserID;

    elements.oidcSettingsForm.querySelectorAll("input,button,select,textarea").forEach(function (el) {
      if (el.id === "refresh-oidc-settings-btn") {
        return;
      }
      el.disabled = disableIAMWrite;
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
    } catch (error) {
      payload = text;
    }

    if (!response.ok) {
      throw new Error(typeof payload === "string" ? payload : pretty(payload));
    }

    return payload;
  }

  async function refreshHealth() {
    try {
      const health = await api("/healthz");
      elements.healthOutput.textContent = pretty(health);
      logActivity("Health check succeeded.");
    } catch (error) {
      elements.healthOutput.textContent = error.message;
      logActivity("Health check failed.");
    }
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
      logActivity("Profile refreshed.");
      return true;
    } catch (error) {
      setToken("");
      state.user = null;
      state.roles = [];
      state.permissions = [];
      writeAuthOutput(error.message, true);
      renderShell();
      logActivity("Profile refresh failed.");
      return false;
    }
  }

  async function refreshAssets() {
    if (!hasPermission("cmdb.asset:read")) {
      state.assets = [];
      renderShell();
      return;
    }
    try {
      const data = await api("/api/v1/cmdb/assets");
      state.assets = data.items || [];
      renderShell();
      logActivity("Asset list refreshed (" + state.assets.length + ").");
    } catch (error) {
      state.assets = [];
      renderShell();
      logActivity("Asset refresh failed.");
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
      logActivity("AWS account list refreshed (" + state.awsAccounts.length + ").");
    } catch (error) {
      state.awsAccounts = [];
      renderShell();
      logActivity("AWS account refresh failed.");
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
      logActivity("AWS sync status refresh failed.");
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
      logActivity("AWS sync run list refreshed (" + state.awsSyncRuns.length + ").");
    } catch (error) {
      state.awsSyncRuns = [];
      renderShell();
      logActivity("AWS sync runs refresh failed.");
    }
  }

  async function triggerAwsSync() {
    if (!hasPermission("aws.account:write")) {
      writeAuthOutput("Permission required: aws.account:write", true);
      return;
    }
    try {
      const result = await api("/api/v1/aws/sync/run", { method: "POST", body: "{}" });
      writeAuthOutput(result, false);
      logActivity(result.triggered ? "AWS sync triggered." : "AWS sync already running.");
      await refreshAwsSyncStatus();
      await refreshAwsSyncRuns();
    } catch (error) {
      writeAuthOutput(error.message, true);
      logActivity("AWS sync trigger failed.");
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
      logActivity("IAM users refreshed (" + state.iamUsers.length + ").");
    } catch (error) {
      state.iamUsers = [];
      renderShell();
      logActivity("IAM users refresh failed.");
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
      logActivity("IAM roles refreshed (" + state.iamRoles.length + ").");
    } catch (error) {
      state.iamRoles = [];
      renderShell();
      logActivity("IAM roles refresh failed.");
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
      logActivity("Selected user access refreshed.");
    } catch (error) {
      state.selectedUserIdentity = null;
      renderShell();
      logActivity("Selected user refresh failed.");
    }
  }

  async function viewRolePermissions(roleName) {
    if (!canReadIAM()) {
      return;
    }
    try {
      const data = await api("/api/v1/iam/roles/" + encodeURIComponent(roleName) + "/permissions");
      elements.iamRolePermissionsOutput.textContent = pretty(data);
      logActivity("Viewed permissions for role " + roleName + ".");
    } catch (error) {
      elements.iamRolePermissionsOutput.textContent = error.message;
      logActivity("Role permission query failed.");
    }
  }

  async function bindRoleToSelectedUser() {
    if (!state.selectedUserID) {
      writeAuthOutput("Select a user first.", true);
      return;
    }
    if (!canWriteIAM()) {
      writeAuthOutput("Permission required: iam.user:write", true);
      return;
    }

    const roleName = (elements.iamRoleSelect.value || "").trim();
    if (!roleName) {
      writeAuthOutput("Select a role first.", true);
      return;
    }

    try {
      const identity = await api("/api/v1/iam/users/" + encodeURIComponent(state.selectedUserID) + "/roles", {
        method: "POST",
        body: JSON.stringify({ role_name: roleName }),
      });
      state.selectedUserIdentity = identity;
      syncSelectedUserRolesToList();
      renderShell();
      writeAuthOutput(identity, false);
      logActivity("Bound role " + roleName + " to selected user.");
    } catch (error) {
      writeAuthOutput(error.message, true);
      logActivity("Bind role failed.");
    }
  }

  async function unbindRoleFromSelectedUser(roleName) {
    if (!state.selectedUserID) {
      writeAuthOutput("Select a user first.", true);
      return;
    }
    if (!canWriteIAM()) {
      writeAuthOutput("Permission required: iam.user:write", true);
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
      writeAuthOutput(identity, false);
      logActivity("Unbound role " + roleName + " from selected user.");
    } catch (error) {
      writeAuthOutput(error.message, true);
      logActivity("Unbind role failed.");
    }
  }

  async function refreshOIDCSettings() {
    if (!canReadIAM()) {
      state.oidcSettings = null;
      renderShell();
      return;
    }
    try {
      state.oidcSettings = await api("/api/v1/iam/oidc-config");
      renderShell();
      logActivity("OIDC settings refreshed.");
    } catch (error) {
      state.oidcSettings = null;
      renderShell();
      logActivity("OIDC settings refresh failed.");
    }
  }

  async function saveOIDCSettings(event) {
    event.preventDefault();

    if (!canWriteIAM()) {
      writeAuthOutput("Permission required: iam.user:write", true);
      return;
    }

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

    if (!body.client_secret) {
      delete body.client_secret;
    }

    try {
      const settings = await api("/api/v1/iam/oidc-config", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      state.oidcSettings = settings;
      renderShell();
      writeAuthOutput(settings, false);
      logActivity("OIDC settings updated.");
    } catch (error) {
      writeAuthOutput(error.message, true);
      logActivity("OIDC settings update failed.");
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
      writeAuthOutput({ created_asset: created }, false);
      event.target.reset();
      await refreshAssets();
      logActivity("Asset created: " + body.name);
    } catch (error) {
      writeAuthOutput(error.message, true);
      logActivity("Asset create failed.");
    }
  }

  async function createAwsAccount(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const body = {
      account_id: String(form.get("account_id") || "").trim(),
      display_name: String(form.get("display_name") || "").trim(),
      auth_mode: String(form.get("auth_mode") || "assume_role"),
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
      writeAuthOutput({ created_aws_account: created }, false);
      event.target.reset();
      await refreshAwsAccounts();
      logActivity("AWS account created: " + body.account_id);
    } catch (error) {
      writeAuthOutput(error.message, true);
      logActivity("AWS account create failed.");
    }
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

    const username = String(elements.localUsername.value || "").trim();
    const password = String(elements.localPassword.value || "");
    if (!username || !password) {
      writeAuthOutput("username and password are required", true);
      return;
    }

    try {
      const data = await api("/auth/local/login", {
        method: "POST",
        body: JSON.stringify({ username: username, password: password }),
      });
      setToken(data.access_token || "");
      elements.localPassword.value = "";
      writeAuthOutput(data, false);
      logActivity("Local login succeeded.");

      const ok = await refreshProfile();
      if (ok) {
        await loadAuthorizedData();
      }
    } catch (error) {
      writeAuthOutput(error.message, true);
      logActivity("Local login failed.");
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
    renderShell();
    writeAuthOutput("Signed out.", false);
    logActivity("Signed out.");
  }

  function bindEvents() {
    elements.localLoginForm.addEventListener("submit", localLogin);
    elements.oidcLoginBtn.addEventListener("click", oidcLogin);
    elements.logoutBtn.addEventListener("click", logout);

    elements.navItems.forEach(function (item) {
      item.addEventListener("click", function () {
        setView(item.dataset.view || "overview");
      });
    });

    elements.refreshOverviewBtn.addEventListener("click", refreshHealth);
    elements.refreshAssetsBtn.addEventListener("click", refreshAssets);
    elements.assetSearch.addEventListener("input", renderAssetTable);
    elements.assetForm.addEventListener("submit", createAsset);

    elements.refreshAwsBtn.addEventListener("click", refreshAwsAccounts);
    elements.awsForm.addEventListener("submit", createAwsAccount);
    elements.triggerAwsSyncBtn.addEventListener("click", triggerAwsSync);
    elements.refreshSyncBtn.addEventListener("click", async function () {
      await refreshAwsSyncStatus();
      await refreshAwsSyncRuns();
    });

    elements.refreshIamUsersBtn.addEventListener("click", refreshIAMUsers);
    elements.refreshIamRolesBtn.addEventListener("click", refreshIAMRoles);
    elements.refreshIamSelectionBtn.addEventListener("click", refreshSelectedUserIdentity);
    elements.iamBindRoleBtn.addEventListener("click", bindRoleToSelectedUser);
    elements.refreshOIDCSettingsBtn.addEventListener("click", refreshOIDCSettings);
    elements.oidcSettingsForm.addEventListener("submit", saveOIDCSettings);

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

    elements.refreshProfileBtn.addEventListener("click", async function () {
      const ok = await refreshProfile();
      if (ok) {
        await loadAuthorizedData();
      }
    });
  }

  async function bootstrap() {
    bindEvents();
    setView("overview");
    renderShell();

    await refreshHealth();
    const ok = await refreshProfile();
    if (ok) {
      await loadAuthorizedData();
    }
  }

  bootstrap();
})();
