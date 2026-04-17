(function () {
  const TOKEN_KEY = "ops_platform_access_token";

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    user: null,
    roles: [],
    permissions: [],
    assets: [],
    assetTotal: 0,
    assetQuery: { env: "", type: "", status: "", source: "", region: "", criticality: "", q: "", limit: 25, offset: 0 },
    assetDrawer: { open: false, asset: null, labels: [], connection: null, probe: null, relations: [], connEdit: null, busy: "" },
    sshProxies: [],
    proxyForm: null,
    proxyFormBusy: false,
    hostkeys: [],
    keypairs: [],
    keypairForm: { open: false, busy: false },
    sessions: [],
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
    toggleAssetFormBtn: $("toggle-asset-form-btn"),
    assetFormPanel: $("asset-form-panel"),
    assetForm: $("asset-form"),
    cancelAssetForm: $("cancel-asset-form"),
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
    awsFormPanel: $("aws-form-panel"),
    awsForm: $("aws-form"),
    cancelAwsForm: $("cancel-aws-form"),
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

  function setView(view) {
    state.view = view;
    elements.navItems.forEach((item) => {
      item.classList.toggle("active", item.dataset.view === view);
    });
    elements.views.forEach((node) => {
      node.classList.toggle("active", node.id === "view-" + view);
    });
    if (view === "proxies") {
      loadSSHProxies().then(renderProxiesView);
    }
    if (view === "hostkeys") {
      loadHostKeys().then(renderHostKeysView);
    }
    if (view === "keypairs") {
      loadKeypairs().then(renderKeypairsView);
    }
    if (view === "sessions") {
      loadSessions().then(renderSessionsView);
      startSessionsAutoRefresh();
    } else {
      stopSessionsAutoRefresh();
    }
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

  // ===== Host keys =====

  const hostkeysFilter = { scope: "all", q: "" };

  async function loadHostKeys() {
    try {
      const res = await api("/api/v1/cmdb/hostkeys/");
      state.hostkeys = Array.isArray(res.items) ? res.items : [];
    } catch (err) {
      state.hostkeys = [];
      logActivity("Load host keys failed: " + err.message, "error");
    }
  }

  function filteredHostKeys() {
    const q = hostkeysFilter.q.trim().toLowerCase();
    return (state.hostkeys || []).filter((k) => {
      if (hostkeysFilter.scope !== "all" && k.scope !== hostkeysFilter.scope) return false;
      if (!q) return true;
      return [k.target_name, k.target_id, k.host, k.fingerprint_sha256]
        .some((v) => (v || "").toLowerCase().includes(q));
    });
  }

  function renderHostKeysView() {
    const view = document.getElementById("view-hostkeys");
    if (!view) return;
    const items = filteredHostKeys();
    const canWrite = writeAccess();
    const pendingCount = (state.hostkeys || []).filter((k) => k.status === "override_pending").length;
    const mismatchCount = (state.hostkeys || []).filter((k) => k.last_mismatch_at && k.status === "active").length;

    const rows = items.map((k) => {
      const overrideBadge = k.status === "override_pending"
        ? '<span class="badge warning" title="Expires ' + safe(k.override_expires_at || "") + '">override pending</span>'
        : '';
      const mismatchBadge = k.last_mismatch_at && k.status === "active"
        ? '<span class="badge error" title="' + safe(k.last_mismatch_fingerprint) + '">mismatch ' + safe(relativeTime(k.last_mismatch_at)) + '</span>'
        : '';
      const statusCell = k.status === "override_pending"
        ? overrideBadge
        : (mismatchBadge || '<span class="badge success">active</span>');

      const overrideBtn = canWrite && k.status !== "override_pending"
        ? '<button class="btn ghost" data-action="override" data-scope="' + safe(k.scope) + '" data-id="' + safe(k.target_id) + '">Approve override</button>'
        : '';
      const cancelBtn = canWrite && k.status === "override_pending"
        ? '<button class="btn ghost" data-action="delete" data-scope="' + safe(k.scope) + '" data-id="' + safe(k.target_id) + '" title="Cancels the override by forgetting the pin">Cancel</button>'
        : '';
      const deleteBtn = canWrite
        ? '<button class="btn ghost danger" data-action="delete" data-scope="' + safe(k.scope) + '" data-id="' + safe(k.target_id) + '">Forget</button>'
        : '';

      const overrideInfo = k.status === "override_pending"
        ? '<div class="sub muted">by ' + safe(k.override_by || "admin") + ' · expires ' + safe(relativeTime(k.override_expires_at)) + '</div>'
        : '';
      const mismatchInfo = k.last_mismatch_at && k.status === "active"
        ? '<div class="sub muted">offered <code>' + safe(k.last_mismatch_fingerprint) + '</code></div>'
        : '';

      return '<tr>' +
        '<td><span class="badge neutral">' + safe(k.scope) + '</span></td>' +
        '<td><div>' + safe(k.target_name || k.target_id) + '</div><div class="sub muted">' + safe(k.target_id) + '</div></td>' +
        '<td>' + safe(k.host) + ':' + safe(k.port) + '</td>' +
        '<td>' +
          '<div class="fingerprint-row">' +
            '<code>' + safe(k.fingerprint_sha256) + '</code>' +
            '<button class="icon-btn" data-action="copy" data-fp="' + safe(k.fingerprint_sha256) + '" title="Copy fingerprint">' +
              '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="sub muted">' + safe(k.key_type) + '</div>' +
          mismatchInfo + overrideInfo +
        '</td>' +
        '<td>' + statusCell + '</td>' +
        '<td title="' + safe(k.last_seen_at) + '">' + safe(relativeTime(k.last_seen_at)) + '</td>' +
        '<td class="row-actions">' + (cancelBtn || overrideBtn) + ' ' + deleteBtn + '</td>' +
      '</tr>';
    }).join("");

    const scopeBtn = (val, label) =>
      '<button class="chip' + (hostkeysFilter.scope === val ? ' active' : '') + '" data-scope-filter="' + val + '">' + label + '</button>';

    view.innerHTML =
      '<div class="page-header"><div><h1>SSH host keys</h1>' +
      '<p class="subtitle">Pinned server fingerprints (TOFU). Approve an override when a server is legitimately re-keyed.</p></div>' +
      '<div class="page-actions"><button id="hostkeys-refresh" class="btn ghost">Refresh</button></div></div>' +
      '<div class="kpi-grid"><div class="kpi"><div class="kpi-label">Pinned</div><div class="kpi-value">' + (state.hostkeys || []).length + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Override pending</div><div class="kpi-value">' + pendingCount + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Recent mismatch</div><div class="kpi-value">' + mismatchCount + '</div></div></div>' +
      '<div class="toolbar">' +
        '<div class="chip-group">' + scopeBtn("all", "All") + scopeBtn("asset", "Assets") + scopeBtn("proxy", "Proxies") + '</div>' +
        '<input id="hostkeys-q" class="input" placeholder="Search target / host / fingerprint" value="' + safe(hostkeysFilter.q) + '" />' +
      '</div>' +
      (items.length === 0
        ? '<div class="empty-state">No matching host keys.</div>'
        : '<table class="table"><thead><tr><th>Scope</th><th>Target</th><th>Host</th><th>Fingerprint</th><th>Status</th><th>Last seen</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>');

    const refresh = document.getElementById("hostkeys-refresh");
    if (refresh) refresh.addEventListener("click", () => loadHostKeys().then(renderHostKeysView));
    view.querySelectorAll("[data-scope-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        hostkeysFilter.scope = btn.dataset.scopeFilter;
        renderHostKeysView();
      });
    });
    const q = document.getElementById("hostkeys-q");
    if (q) {
      q.addEventListener("input", () => {
        hostkeysFilter.q = q.value;
        renderHostKeysView();
        const refocus = document.getElementById("hostkeys-q");
        if (refocus) { refocus.focus(); refocus.setSelectionRange(q.value.length, q.value.length); }
      });
    }
    view.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.action === "copy") return copyToClipboard(btn.dataset.fp || "");
        onHostKeyAction(btn.dataset.action, btn.dataset.scope, btn.dataset.id);
      });
    });
  }

  async function onHostKeyAction(action, scope, id) {
    try {
      if (action === "override") {
        if (!confirm("Approve one-time override for " + scope + "/" + id + "?\nNext connection will replace the pinned fingerprint.")) return;
        const resp = await api("/api/v1/cmdb/hostkeys/" + encodeURIComponent(scope) + "/" + encodeURIComponent(id) + "/override", { method: "POST", body: "{}" });
        toast("Override approved · " + (resp.ttl_minute || 10) + " min window", "success");
        logActivity("Host key override approved: " + scope + "/" + id, "success");
      } else if (action === "delete") {
        if (!confirm("Forget pinned host key for " + scope + "/" + id + "? Next connect will TOFU-record fresh.")) return;
        await api("/api/v1/cmdb/hostkeys/" + encodeURIComponent(scope) + "/" + encodeURIComponent(id), { method: "DELETE" });
        toast("Host key forgotten", "success");
        logActivity("Host key forgotten: " + scope + "/" + id, "success");
      }
      await loadHostKeys();
      renderHostKeysView();
    } catch (err) {
      toast("Host key action failed: " + err.message, "error");
    }
  }

  // ===== SSH keypairs =====

  async function loadKeypairs() {
    try {
      const res = await api("/api/v1/ssh-keypairs/");
      state.keypairs = Array.isArray(res) ? res : [];
    } catch (err) {
      state.keypairs = [];
      logActivity("Load keypairs failed: " + err.message, "error");
    }
  }

  function renderKeypairsView() {
    const view = document.getElementById("view-keypairs");
    if (!view) return;
    const canWrite = writeAccess();

    const rows = (state.keypairs || []).map((k) => {
      const passBadge = k.has_passphrase
        ? '<span class="badge warning">passphrase</span>'
        : '<span class="badge neutral">no passphrase</span>';
      const deleteBtn = canWrite
        ? '<button class="btn ghost danger" data-action="delete" data-id="' + safe(k.id) + '" data-name="' + safe(k.name) + '">Delete</button>'
        : '';
      return '<tr>' +
        '<td><strong>' + safe(k.name) + '</strong><div class="sub muted">' + safe(k.description || '') + '</div></td>' +
        '<td><code>' + safe(k.fingerprint) + '</code></td>' +
        '<td>' + passBadge + '</td>' +
        '<td>' + safe(k.uploaded_by || '—') + '</td>' +
        '<td title="' + safe(k.updated_at) + '">' + safe(relativeTime(k.updated_at)) + '</td>' +
        '<td class="row-actions">' + deleteBtn + '</td>' +
      '</tr>';
    }).join("");

    const formOpen = state.keypairForm.open;
    const formBusy = state.keypairForm.busy;
    const newBtn = canWrite
      ? '<button id="keypair-toggle-form" class="btn primary">' +
        '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Upload .pem</button>'
      : '';

    const formPanel = canWrite && formOpen
      ? '<section class="panel">' +
          '<div class="panel-head"><div><h2>Upload private key</h2>' +
            '<div class="panel-hint">Name must match the EC2 KeyPair name. Key is validated, fingerprinted, and encrypted at rest (AES-256-GCM).</div></div></div>' +
          '<div class="panel-body">' +
            '<form id="keypair-form">' +
              '<div class="form-grid">' +
                '<div class="field"><label>Key name</label>' +
                  '<input name="name" placeholder="e.g. my-ec2-key" required />' +
                  '<span class="hint">EC2 assets with this KeyName will auto-associate.</span></div>' +
                '<div class="field"><label>Passphrase</label>' +
                  '<input name="passphrase" type="password" placeholder="Leave blank for no passphrase" /></div>' +
                '<div class="field full"><label>Description</label>' +
                  '<input name="description" /></div>' +
                '<div class="field full"><label>Private key (.pem)</label>' +
                  '<input name="pemfile" type="file" accept=".pem,.key,.txt" />' +
                  '<textarea name="private_key" rows="6" placeholder="Paste the contents or choose a .pem file above" style="margin-top: 8px; width: 100%; font-family: monospace; font-size: 12px; padding: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text);" required></textarea></div>' +
              '</div>' +
              '<div class="form-actions">' +
                '<button type="button" class="btn ghost" id="keypair-cancel">Cancel</button>' +
                '<button type="submit" class="btn primary"' + (formBusy ? ' disabled' : '') + '>' +
                  (formBusy ? 'Uploading...' : 'Upload') +
                '</button>' +
              '</div>' +
            '</form>' +
          '</div>' +
        '</section>'
      : '';

    view.innerHTML =
      '<div class="page-header"><div><h1>SSH keypairs</h1>' +
      '<p class="subtitle">Central store of private keys. EC2 assets with a matching KeyName will use these automatically.</p></div>' +
      '<div class="page-actions"><button id="keypairs-refresh" class="btn ghost">Refresh</button>' + newBtn + '</div></div>' +
      formPanel +
      '<section class="panel"><div class="panel-head"><div><h2>Stored keys</h2>' +
        '<div class="panel-hint">' + (state.keypairs || []).length + ' total</div></div></div>' +
        '<div class="panel-body flush">' +
          ((state.keypairs || []).length === 0
            ? '<div class="timeline-empty" style="padding: 24px;">No keypairs uploaded.</div>'
            : '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Fingerprint</th><th>Passphrase</th><th>Uploaded by</th><th>Updated</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>') +
        '</div>' +
      '</section>';

    const refresh = document.getElementById("keypairs-refresh");
    if (refresh) refresh.addEventListener("click", () => loadKeypairs().then(renderKeypairsView));
    const toggleBtn = document.getElementById("keypair-toggle-form");
    if (toggleBtn) toggleBtn.addEventListener("click", () => {
      state.keypairForm.open = !state.keypairForm.open;
      renderKeypairsView();
    });
    const cancelBtn = document.getElementById("keypair-cancel");
    if (cancelBtn) cancelBtn.addEventListener("click", () => {
      state.keypairForm.open = false;
      renderKeypairsView();
    });
    const form = document.getElementById("keypair-form");
    if (form) {
      const fileInput = form.querySelector('input[name="pemfile"]');
      const pkInput = form.querySelector('textarea[name="private_key"]');
      const nameInput = form.querySelector('input[name="name"]');
      if (fileInput) fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (nameInput && !nameInput.value.trim()) {
          nameInput.value = file.name.replace(/\.(pem|key|txt)$/i, "");
        }
        const reader = new FileReader();
        reader.onload = () => { if (pkInput) pkInput.value = String(reader.result || ""); };
        reader.readAsText(file);
      });
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        onKeypairSubmit(form);
      });
    }
    view.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.action === "delete") onKeypairDelete(btn.dataset.id, btn.dataset.name);
      });
    });
  }

  async function onKeypairSubmit(form) {
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || "").trim(),
      private_key: String(data.get("private_key") || ""),
      description: String(data.get("description") || "").trim(),
    };
    const pass = String(data.get("passphrase") || "");
    if (pass) payload.passphrase = pass;
    if (!payload.name || !payload.private_key) {
      toast("Name and private key are required", "error");
      return;
    }
    state.keypairForm.busy = true;
    renderKeypairsView();
    try {
      await api("/api/v1/ssh-keypairs/", { method: "POST", body: JSON.stringify(payload) });
      toast("Keypair uploaded", "success");
      logActivity("Keypair uploaded: " + payload.name, "success");
      state.keypairForm.open = false;
      await loadKeypairs();
    } catch (err) {
      toast("Upload failed: " + err.message, "error");
    } finally {
      state.keypairForm.busy = false;
      renderKeypairsView();
    }
  }

  async function onKeypairDelete(id, name) {
    if (!id) return;
    if (!confirm("Delete keypair \"" + (name || id) + "\"? Assets referencing this KeyName will lose SSH access until re-uploaded.")) return;
    try {
      await api("/api/v1/ssh-keypairs/" + encodeURIComponent(id), { method: "DELETE" });
      toast("Keypair deleted", "success");
      logActivity("Keypair deleted: " + (name || id), "success");
      await loadKeypairs();
      renderKeypairsView();
    } catch (err) {
      toast("Delete failed: " + err.message, "error");
    }
  }

  // ===== Sessions =====

  const sessionsFilter = { user: "", asset: "", onlyActive: false };
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
    return (state.sessions || []).filter((s) => {
      if (sessionsFilter.onlyActive && s.ended_at) return false;
      return true;
    });
  }

  function renderSessionsView() {
    const view = document.getElementById("view-sessions");
    if (!view) return;
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
      return '<tr>' +
        '<td title="' + safe(s.started_at) + '">' + safe(relativeTime(s.started_at)) + '</td>' +
        '<td>' + safe(s.user_name || s.user_id) + '</td>' +
        '<td>' + safe(s.asset_name || s.asset_id) + proxy + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' + dur + '</td>' +
        '<td>' + formatBytes(s.bytes_in) + ' / ' + formatBytes(s.bytes_out) + '</td>' +
        '<td>' + safe(s.client_ip) + '</td>' +
        errCell +
      '</tr>';
    }).join("");

    view.innerHTML =
      '<div class="page-header"><div><h1>Terminal sessions</h1>' +
      '<p class="subtitle">Audit log of WebSSH sessions. Auto-refresh every 10s while open.</p></div>' +
      '<div class="page-actions"><button id="sessions-refresh" class="btn ghost">Refresh</button></div></div>' +
      '<div class="kpi-grid"><div class="kpi"><div class="kpi-label">Shown</div><div class="kpi-value">' + items.length + '</div></div>' +
      '<div class="kpi"><div class="kpi-label">Active now</div><div class="kpi-value">' + active + '</div></div></div>' +
      '<div class="toolbar">' +
        '<input id="sessions-user" class="input" placeholder="Filter by user UUID" value="' + safe(sessionsFilter.user) + '" />' +
        '<input id="sessions-asset" class="input" placeholder="Filter by asset UUID" value="' + safe(sessionsFilter.asset) + '" />' +
        '<label class="chip' + (sessionsFilter.onlyActive ? ' active' : '') + '"><input type="checkbox" id="sessions-only-active"' + (sessionsFilter.onlyActive ? ' checked' : '') + ' /> Active only</label>' +
        '<button id="sessions-apply" class="btn">Apply</button>' +
      '</div>' +
      (items.length === 0
        ? '<div class="empty-state">No sessions recorded yet.</div>'
        : '<table class="table"><thead><tr><th>Started</th><th>User</th><th>Asset</th><th>Status</th><th>Duration</th><th>In / Out</th><th>Client IP</th><th>Error</th></tr></thead><tbody>' + rows + '</tbody></table>');

    const refresh = document.getElementById("sessions-refresh");
    if (refresh) refresh.addEventListener("click", () => loadSessions().then(renderSessionsView));

    const userInput = document.getElementById("sessions-user");
    const assetInput = document.getElementById("sessions-asset");
    const onlyActive = document.getElementById("sessions-only-active");
    const applyBtn = document.getElementById("sessions-apply");
    const apply = () => {
      sessionsFilter.user = (userInput && userInput.value) || "";
      sessionsFilter.asset = (assetInput && assetInput.value) || "";
      sessionsFilter.onlyActive = !!(onlyActive && onlyActive.checked);
      loadSessions().then(renderSessionsView);
    };
    if (applyBtn) applyBtn.addEventListener("click", apply);
    [userInput, assetInput].forEach((el) => {
      if (!el) return;
      el.addEventListener("keydown", (ev) => { if (ev.key === "Enter") apply(); });
    });
    if (onlyActive) onlyActive.addEventListener("change", apply);
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
          return (
            '<tr data-asset-id="' + safe(asset.id) + '">' +
            '<td><div class="primary">' + safe(asset.name) + '</div>' +
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
            '<button class="btn ghost small" data-connect-asset="' + safe(asset.id) + '" title="Open terminal">Connect</button>' +
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

  function isFilterActive() {
    const q = state.assetQuery;
    return !!(q.env || q.status || q.source || q.region || q.criticality || q.q);
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
    elements.assetDrawerSub.innerHTML =
      (asset.external_id ? '<code>' + safe(asset.external_id) + '</code>' : '<span class="muted">—</span>');

    const identity = kvList([
      ["Status", statusPill(asset.status)],
      ["Criticality", criticalityPill(asset.criticality)],
      ["Environment", safe(asset.env || "default")],
      ["Source", sourcePill(asset.source)],
      ["Created", safe(formatDate(asset.created_at))],
      ["Updated", safe(formatDate(asset.updated_at))],
      ["Expires", asset.expires_at ? safe(formatDate(asset.expires_at)) : '<span class="muted">—</span>'],
    ]);

    const infra = kvList([
      ["Region", asset.region ? '<code>' + safe(asset.region) + '</code>' : dash()],
      ["Zone", asset.zone ? '<code>' + safe(asset.zone) + '</code>' : dash()],
      ["Account", asset.account_id ? '<code>' + safe(asset.account_id) + '</code>' : dash()],
      ["Instance type", asset.instance_type ? '<code>' + safe(asset.instance_type) + '</code>' : dash()],
      ["OS image", asset.os_image ? '<code>' + safe(asset.os_image) + '</code>' : dash()],
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

    elements.assetDrawerBody.innerHTML =
      section("Identity", identity) +
      section("Infrastructure", infra) +
      section("Network", network) +
      section("Ownership", business) +
      section("Bastion connection", renderConnectionSection()) +
      section("Last probe", renderProbeSection()) +
      section("Relations", renderRelationsSection()) +
      section("System tags", systemSection + '<div class="muted" style="margin-top:6px;font-size:12px">Managed by sync. Read-only.</div>') +
      section("Labels", labelsEditor + (canWrite
        ? '<div class="drawer-footer">' +
          '<button type="button" class="btn ghost" id="drawer-cancel-btn">Reset</button>' +
          '<button type="button" class="btn primary" id="drawer-save-btn">Save labels</button>' +
          '</div>'
        : ''));

    if (canWrite) bindLabelsEditorEvents();
    bindConnectionSectionEvents();
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
    const assetID = state.assetDrawer.asset ? state.assetDrawer.asset.id : "";
    if (rels.length === 0) return '<div class="muted">No relations.</div>';
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
    return rows;
  }

  function bindRelationEvents() {
    elements.assetDrawerBody.querySelectorAll("[data-open-asset]").forEach((link) => {
      link.addEventListener("click", (ev) => {
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
    const authFields = (!isPg && edit.auth_type === "key") ? keyField : passwordField;

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
      '</select></div>';

    const databaseField = isPg
      ? '<div class="field"><label>Database</label><input data-conn="database" value="' + safe(edit.database) + '" placeholder="postgres" ' + (canWrite ? '' : 'disabled') + ' /></div>'
      : '';

    const authTypeField = isPg
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
          (edit.protocol !== "postgres"
            ? '<button type="button" class="btn ghost" id="conn-terminal-btn" ' + (busy ? "disabled" : "") + '>Open terminal</button>'
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
  }

  async function saveConnection() {
    const asset = state.assetDrawer.asset;
    const edit = state.assetDrawer.connEdit;
    if (!asset || !edit) return;
    const protocol = edit.protocol || "ssh";
    const defaultPort = protocol === "postgres" ? 5432 : 22;
    const body = {
      protocol,
      host: (edit.host || "").trim(),
      port: Number(edit.port) || defaultPort,
      username: (edit.username || "").trim(),
      auth_type: protocol === "postgres" ? "password" : (edit.auth_type || "password"),
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

  const terminalState = { ws: null, term: null, fit: null, assetID: null, resizeObserver: null };

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
      openTerminalModal(asset, resp.ticket);
    } catch (error) {
      toast("Connect failed: " + error.message, "error");
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
      openTerminalModal(asset, resp.ticket);
    } catch (error) {
      toast("Terminal open failed: " + error.message, "error");
    }
  }

  function openTerminalModal(asset, ticket) {
    const modal = $("terminal-modal");
    const mount = $("terminal-mount");
    const statusEl = $("terminal-status");
    if (!modal || !mount || !statusEl || !window.Terminal) {
      toast("Terminal component not loaded", "error");
      return;
    }
    closeTerminalModal();
    $("terminal-eyebrow").textContent = (asset.type || "asset") + " · " + (asset.env || "");
    $("terminal-title").textContent = asset.name || asset.id;

    const term = new window.Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", Menlo, monospace',
      theme: { background: "#000000" },
    });
    const FitCtor = window.FitAddon && window.FitAddon.FitAddon;
    const fit = FitCtor ? new FitCtor() : null;
    if (fit) term.loadAddon(fit);
    term.open(mount);
    if (fit) fit.fit();

    modal.setAttribute("aria-hidden", "false");
    statusEl.textContent = "connecting";
    statusEl.className = "pill neutral";

    const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = wsProto + "//" + location.host + "/ws/v1/cmdb/assets/" +
      encodeURIComponent(asset.id) + "/terminal?ticket=" + encodeURIComponent(ticket);
    const ws = new WebSocket(url);
    terminalState.ws = ws;
    terminalState.term = term;
    terminalState.fit = fit;
    terminalState.assetID = asset.id;

    ws.onopen = () => {
      statusEl.textContent = "connected";
      statusEl.className = "pill success";
      if (fit) {
        fit.fit();
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
        statusEl.textContent = "error";
        statusEl.className = "pill danger";
        maybeShowHostKeyBanner(asset, frame.message || "");
      } else if (frame.type === "exit") {
        term.write("\r\n\x1b[33m[session exited code=" + (frame.code || 0) + "]\x1b[0m\r\n");
        statusEl.textContent = "closed";
        statusEl.className = "pill neutral";
      }
    };
    ws.onclose = () => {
      statusEl.textContent = "disconnected";
      statusEl.className = "pill neutral";
    };
    ws.onerror = () => {
      statusEl.textContent = "error";
      statusEl.className = "pill danger";
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", payload: data }));
      }
    });

    const onResize = () => {
      if (fit) {
        try { fit.fit(); } catch (e) { /* ignore */ }
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", onResize);
    terminalState.onResize = onResize;

    // close handlers
    modal.querySelectorAll("[data-terminal-close]").forEach((el) => {
      el.addEventListener("click", closeTerminalModal, { once: true });
    });
  }

  function maybeShowHostKeyBanner(asset, message) {
    if (!/host key mismatch/i.test(message)) return;
    const mount = $("terminal-mount");
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
            await api("/api/v1/cmdb/hostkeys/asset/" + encodeURIComponent(asset.id) + "/override", { method: "POST", body: "{}" });
            toast("Override approved, reconnecting", "success");
            closeTerminalModal();
            setTimeout(() => openTerminalForCurrentAsset(), 250);
          } catch (err) {
            toast("Override failed: " + err.message, "error");
            btn.disabled = false;
            btn.textContent = "Approve one-time override & reconnect";
          }
        }
      });
    });
  }

  function closeTerminalModal() {
    const modal = $("terminal-modal");
    if (!modal) return;
    if (terminalState.ws) {
      try { terminalState.ws.close(); } catch (e) { /* ignore */ }
      terminalState.ws = null;
    }
    if (terminalState.term) {
      try { terminalState.term.dispose(); } catch (e) { /* ignore */ }
      terminalState.term = null;
    }
    if (terminalState.onResize) {
      window.removeEventListener("resize", terminalState.onResize);
      terminalState.onResize = null;
    }
    const mount = $("terminal-mount");
    if (mount) mount.innerHTML = "";
    modal.setAttribute("aria-hidden", "true");
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

  function renderAwsAccounts() {
    if (!hasPermission("aws.account:read")) {
      elements.cloudAccountsBody.innerHTML =
        '<tr class="empty-row"><td colspan="5">Permission required: aws.account:read</td></tr>';
      return;
    }

    if (state.awsAccounts.length === 0) {
      elements.cloudAccountsBody.innerHTML =
        '<tr class="empty-row"><td colspan="5">No AWS accounts connected yet.</td></tr>';
      return;
    }

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
        return (
          "<tr>" +
          '<td><div class="primary">' + safe(item.display_name) + '</div>' +
          '<div class="muted">' + safe(item.account_id) + '</div></td>' +
          "<td>" + safe(item.auth_mode) + "</td>" +
          "<td>" + roleKey + "</td>" +
          '<td><div class="chips">' + regions + "</div></td>" +
          "<td>" + enabled + "</td>" +
          "</tr>"
        );
      })
      .join("");
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

  function renderAwsSyncRuns() {
    if (!hasPermission("aws.account:read")) {
      elements.syncRunsBody.innerHTML =
        '<tr class="empty-row"><td colspan="6">Permission required: aws.account:read</td></tr>';
      return;
    }
    if (state.awsSyncRuns.length === 0) {
      elements.syncRunsBody.innerHTML =
        '<tr class="empty-row"><td colspan="6">No sync runs yet.</td></tr>';
      return;
    }
    elements.syncRunsBody.innerHTML = state.awsSyncRuns
      .map((run) => {
        return (
          "<tr>" +
          "<td>" + safe(formatDateTime(run.started_at)) + "</td>" +
          '<td><div class="primary">' + safe(run.account_display_name || "—") + '</div>' +
          '<div class="muted">' + safe(run.account_id || "") + "</div></td>" +
          "<td><code>" + safe(run.region || "—") + "</code></td>" +
          "<td>" + safe(run.resource_type || "—") + "</td>" +
          "<td>" + statusPill(run.status) + "</td>" +
          '<td style="text-align: right;">' + String(run.resources_processed || 0) + "</td>" +
          "</tr>"
        );
      })
      .join("");
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
    if (elements.assetForm) {
      elements.assetForm.querySelectorAll("input,button,select,textarea").forEach((el) => {
        if (el.id === "cancel-asset-form") return;
        el.disabled = !canWriteAsset;
      });
    }

    const canWriteAws = hasPermission("aws.account:write");
    elements.toggleAwsFormBtn.disabled = !canWriteAws;
    if (elements.awsForm) {
      elements.awsForm.querySelectorAll("input,button,select,textarea").forEach((el) => {
        if (el.id === "cancel-aws-form") return;
        el.disabled = !canWriteAws;
      });
    }
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
      throw new Error(message);
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
    add("limit", q.limit);
    add("offset", q.offset);
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

  async function createAsset(event) {
    event.preventDefault();
    const form = new FormData(event.target);
    const s = (k) => String(form.get(k) || "").trim();
    const body = {
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
      await api("/api/v1/cmdb/assets", { method: "POST", body: JSON.stringify(body) });
      event.target.reset();
      elements.assetFormPanel.style.display = "none";
      await refreshAssets();
      toast("Asset created: " + body.name, "success");
      logActivity("Asset created: " + body.name, "success");
    } catch (error) {
      toast("Create failed: " + error.message, "error");
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
      region_allowlist: parseCSV(String(form.get("region_allowlist") || "")),
      enabled: true,
    };
    try {
      await api("/api/v1/aws/accounts", { method: "POST", body: JSON.stringify(body) });
      event.target.reset();
      elements.awsFormPanel.style.display = "none";
      await refreshAwsAccounts();
      toast("AWS account added: " + body.account_id, "success");
      logActivity("AWS account added: " + body.account_id, "success");
    } catch (error) {
      toast("Create failed: " + error.message, "error");
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
      state.assetQuery = { env: "", type: "", status: "", source: "", region: "", q: "", limit: state.assetQuery.limit, offset: 0 };
      elements.assetSearch.value = "";
      refreshAssets();
    });
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

    elements.assetDrawer.addEventListener("click", (event) => {
      if (event.target.closest("[data-drawer-close]")) closeAssetDrawer();
    });

    elements.assetForm.addEventListener("submit", createAsset);
    elements.toggleAssetFormBtn.addEventListener("click", () => {
      const shown = elements.assetFormPanel.style.display !== "none";
      elements.assetFormPanel.style.display = shown ? "none" : "block";
    });
    elements.cancelAssetForm.addEventListener("click", () => {
      elements.assetForm.reset();
      elements.assetFormPanel.style.display = "none";
    });

    elements.refreshAwsBtn.addEventListener("click", refreshAwsAccounts);
    elements.awsForm.addEventListener("submit", createAwsAccount);
    elements.toggleAwsFormBtn.addEventListener("click", () => {
      const shown = elements.awsFormPanel.style.display !== "none";
      elements.awsFormPanel.style.display = shown ? "none" : "block";
    });
    elements.cancelAwsForm.addEventListener("click", () => {
      elements.awsForm.reset();
      elements.awsFormPanel.style.display = "none";
    });
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
  }

  async function bootstrap() {
    bindEvents();
    setView("overview");
    renderShell();

    await refreshHealth();
    const ok = await refreshProfile();
    if (ok) await loadAuthorizedData();
  }

  bootstrap();
})();
