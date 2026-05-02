// SSH host-key management module.
// Depends on: api, state.hostkeys, writeAccess, safe, relativeTime,
// copyToClipboard, toast, logActivity (all defined in app.js).

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
