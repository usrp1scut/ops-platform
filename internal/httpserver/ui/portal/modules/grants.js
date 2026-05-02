// JIT bastion grants UI: lets users submit access requests, lets approvers
// triage them, and shows active grants.
//
// Depends on (from app.js): state, api, hasPermission, safe, relativeTime,
// toast, logActivity. The Terminal/RDP "Connect" buttons elsewhere will
// trigger a 403 with needs_grant=true when the gate refuses; this page is
// where the user submits the corresponding request.

const grantsState = {
  myRequests: [],
  pendingRequests: [],
  activeGrants: [],
  submitting: false,
  // Picker selection: cleared after submit so the form resets cleanly.
  pickedAsset: null,
};

async function loadGrantsData() {
  const tasks = [];
  // Anyone with bastion.request:read sees their own requests.
  tasks.push(api("/api/v1/bastion/requests?mine=true&limit=50").then((r) => {
    grantsState.myRequests = r.items || [];
  }).catch(() => { grantsState.myRequests = []; }));

  if (hasPermission("bastion.grant:write")) {
    tasks.push(api("/api/v1/bastion/requests?status=pending&limit=100").then((r) => {
      grantsState.pendingRequests = r.items || [];
    }).catch(() => { grantsState.pendingRequests = []; }));
  } else {
    grantsState.pendingRequests = [];
  }

  if (hasPermission("bastion.grant:read")) {
    tasks.push(api("/api/v1/bastion/grants?active=true&limit=100").then((r) => {
      grantsState.activeGrants = r.items || [];
    }).catch(() => { grantsState.activeGrants = []; }));
  } else {
    grantsState.activeGrants = [];
  }

  await Promise.all(tasks);
}

function statusBadge(status) {
  switch (status) {
    case "pending":   return '<span class="badge info">pending</span>';
    case "approved":  return '<span class="badge success">approved</span>';
    case "rejected":  return '<span class="badge error">rejected</span>';
    case "cancelled": return '<span class="badge neutral">cancelled</span>';
    case "expired":   return '<span class="badge neutral">expired</span>';
    default:          return '<span class="badge neutral">' + safe(status) + '</span>';
  }
}

function durationLabel(secs) {
  if (!secs) return "";
  if (secs < 3600) return Math.round(secs / 60) + "m";
  return Math.round(secs / 360) / 10 + "h";
}

function renderGrantsView() {
  const view = document.getElementById("view-grants");
  if (!view) return;

  const canApprove = hasPermission("bastion.grant:write");
  const canSeeGrants = hasPermission("bastion.grant:read");
  // Subsection filter — driven by the new section sub-nav. Empty means
  // "render everything stacked", which is the legacy behavior we still want
  // when this page is reached without going through the access section.
  const activeTab = state.accessTab || "my-requests";
  const showMine     = !state.accessTab || activeTab === "my-requests";
  const showPending  = !state.accessTab || activeTab === "pending";
  const showActive   = !state.accessTab || activeTab === "active-grants";

  const myRows = (grantsState.myRequests || []).map((r) => {
    const cancelBtn = r.status === "pending"
      ? '<button class="btn ghost small" data-action="cancel" data-id="' + safe(r.id) + '">Cancel</button>'
      : '';
    return '<tr>' +
      '<td>' + statusBadge(r.status) + '</td>' +
      '<td><strong>' + safe(r.asset_name || r.asset_id) + '</strong><div class="sub muted">' + safe(r.asset_id) + '</div></td>' +
      '<td>' + durationLabel(r.requested_duration_seconds) + '</td>' +
      '<td>' + safe(r.reason || '—') + '</td>' +
      '<td title="' + safe(r.created_at) + '">' + safe(relativeTime(r.created_at)) + '</td>' +
      '<td>' + (r.decided_by_name ? safe(r.decided_by_name) + (r.decision_reason ? '<div class="sub muted">' + safe(r.decision_reason) + '</div>' : '') : '—') + '</td>' +
      '<td class="row-actions">' + cancelBtn + '</td>' +
    '</tr>';
  }).join("");

  const pendingRows = canApprove ? (grantsState.pendingRequests || []).map((r) => {
    return '<tr>' +
      '<td><strong>' + safe(r.user_name || r.user_id) + '</strong></td>' +
      '<td><strong>' + safe(r.asset_name || r.asset_id) + '</strong><div class="sub muted">' + safe(r.asset_id) + '</div></td>' +
      '<td>' + durationLabel(r.requested_duration_seconds) + '</td>' +
      '<td>' + safe(r.reason || '—') + '</td>' +
      '<td title="' + safe(r.created_at) + '">' + safe(relativeTime(r.created_at)) + '</td>' +
      '<td class="row-actions">' +
        '<button class="btn primary small" data-action="approve" data-id="' + safe(r.id) + '">Approve</button> ' +
        '<button class="btn ghost danger small" data-action="reject" data-id="' + safe(r.id) + '">Reject</button>' +
      '</td>' +
    '</tr>';
  }).join("") : "";

  const grantRows = canSeeGrants ? (grantsState.activeGrants || []).map((g) => {
    const expHours = Math.max(0, Math.round((new Date(g.expires_at).getTime() - Date.now()) / 3600000 * 10) / 10);
    return '<tr>' +
      '<td><strong>' + safe(g.user_name || g.user_id) + '</strong></td>' +
      '<td><strong>' + safe(g.asset_name || g.asset_id) + '</strong></td>' +
      '<td title="' + safe(g.expires_at) + '">' + expHours + 'h left</td>' +
      '<td>' + safe(g.granted_by_name) + '</td>' +
      '<td>' + safe(g.reason || '—') + '</td>' +
      '<td class="row-actions">' +
        (canApprove
          ? '<button class="btn ghost danger small" data-action="revoke" data-id="' + safe(g.id) + '">Revoke</button>'
          : '') +
      '</td>' +
    '</tr>';
  }).join("") : "";

  // Subtitle adapts to whichever subsection the operator chose. When the
  // page is loaded without a subsection (legacy entry), keep the original
  // umbrella copy so the user still sees everything stacked.
  const subtitleByTab = {
    "my-requests": "Track the access you have asked for.",
    "pending":     "Approve or reject access requests waiting on you.",
    "active-grants": "Time-bounded access that is currently in force.",
  };
  const subtitle = state.accessTab
    ? (subtitleByTab[activeTab] || "")
    : "Time-bounded grants for SSH/RDP. Submit a request, get it approved, connect within the window.";

  view.innerHTML =
    '<div class="page-header"><div><h1>Access requests</h1>' +
    '<p class="subtitle">' + safe(subtitle) + '</p></div>' +
    '<div class="page-actions"><button id="grants-refresh" class="btn ghost">Refresh</button></div></div>' +

    (showMine
      ? '<section class="panel"><div class="panel-head"><div><h2>Submit a request</h2>' +
          '<div class="panel-hint">Search for an asset by name or IP. The default duration is 1h.</div></div></div>' +
          '<div class="panel-body">' +
            '<form id="grant-request-form" class="form-grid">' +
              '<div class="field full"><label>Asset</label>' +
                '<div class="asset-picker">' +
                  '<input id="grant-request-asset-input" type="text" autocomplete="off" placeholder="Search name / id / ip…" value="' +
                    (grantsState.pickedAsset ? safe(grantsState.pickedAsset.name || grantsState.pickedAsset.id) : '') +
                  '" />' +
                  '<div id="grant-request-asset-results" class="asset-picker-results" hidden></div>' +
                '</div>' +
              '</div>' +
              '<div class="field"><label>Duration</label><select name="duration_seconds"><option value="900">15m</option><option value="1800">30m</option><option value="3600" selected>1h</option><option value="7200">2h</option><option value="14400">4h</option><option value="28800">8h</option></select></div>' +
              '<div class="field full"><label>Reason</label><input name="reason" placeholder="Brief justification (visible to approvers)" /></div>' +
              '<div class="form-actions"><button type="submit" class="btn primary"' + (grantsState.submitting ? ' disabled' : '') + '>' + (grantsState.submitting ? 'Submitting…' : 'Submit') + '</button></div>' +
            '</form>' +
          '</div>' +
        '</section>'
      : '') +

    (showMine
      ? '<section class="panel"><div class="panel-head"><div><h2>My requests</h2>' +
          '<div class="panel-hint">' + (grantsState.myRequests || []).length + ' total</div></div></div>' +
          '<div class="panel-body flush">' +
            ((grantsState.myRequests || []).length === 0
              ? '<div class="timeline-empty" style="padding: 24px;">No requests yet.</div>'
              : '<div class="table-wrap"><table><thead><tr><th>Status</th><th>Asset</th><th>Duration</th><th>Reason</th><th>Submitted</th><th>Decision</th><th></th></tr></thead><tbody>' + myRows + '</tbody></table></div>') +
          '</div>' +
        '</section>'
      : '') +

    (showPending && canApprove
      ? '<section class="panel"><div class="panel-head"><div><h2>Pending approvals</h2>' +
          '<div class="panel-hint">' + (grantsState.pendingRequests || []).length + ' pending</div></div></div>' +
          '<div class="panel-body flush">' +
            ((grantsState.pendingRequests || []).length === 0
              ? '<div class="timeline-empty" style="padding: 24px;">Nothing pending.</div>'
              : '<div class="table-wrap"><table><thead><tr><th>Requester</th><th>Asset</th><th>Duration</th><th>Reason</th><th>Submitted</th><th></th></tr></thead><tbody>' + pendingRows + '</tbody></table></div>') +
          '</div>' +
        '</section>'
      : '') +

    (showActive && canSeeGrants
      ? '<section class="panel"><div class="panel-head"><div><h2>Active grants</h2>' +
          '<div class="panel-hint">' + (grantsState.activeGrants || []).length + ' active</div></div></div>' +
          '<div class="panel-body flush">' +
            ((grantsState.activeGrants || []).length === 0
              ? '<div class="timeline-empty" style="padding: 24px;">No active grants.</div>'
              : '<div class="table-wrap"><table><thead><tr><th>User</th><th>Asset</th><th>Expires</th><th>Granted by</th><th>Reason</th><th></th></tr></thead><tbody>' + grantRows + '</tbody></table></div>') +
          '</div>' +
        '</section>'
      : '');

  const refreshBtn = view.querySelector("#grants-refresh");
  if (refreshBtn) refreshBtn.addEventListener("click", () => loadGrantsData().then(renderGrantsView));

  const form = view.querySelector("#grant-request-form");
  if (form) {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      onGrantRequestSubmit(form);
    });
    bindAssetPicker(view);
  }

  view.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === "cancel") onCancelRequest(id);
      else if (action === "approve") onApproveRequest(id);
      else if (action === "reject") onRejectRequest(id);
      else if (action === "revoke") onRevokeGrant(id);
    });
  });
}

async function onGrantRequestSubmit(form) {
  const data = new FormData(form);
  const reason = String(data.get("reason") || "").trim();
  const duration = parseInt(String(data.get("duration_seconds") || "3600"), 10) || 3600;
  const picked = grantsState.pickedAsset;
  if (!picked || !picked.id) {
    toast("Pick an asset from the search results first", "error");
    return;
  }
  grantsState.submitting = true;
  renderGrantsView();
  try {
    await api("/api/v1/bastion/requests", {
      method: "POST",
      body: JSON.stringify({ asset_id: picked.id, reason, duration_seconds: duration }),
    });
    toast("Request submitted", "success");
    logActivity("Submitted bastion request for " + (picked.name || picked.id), "success");
    grantsState.pickedAsset = null;
    await loadGrantsData();
  } catch (err) {
    toast("Submit failed: " + err.message, "error");
  } finally {
    grantsState.submitting = false;
    renderGrantsView();
  }
}

// bindAssetPicker wires the search-as-you-type combobox. Hits
// /cmdb/assets?q= with a small debounce; results are clickable to fill the
// picked asset into grantsState.
function bindAssetPicker(view) {
  const input = view.querySelector("#grant-request-asset-input");
  const results = view.querySelector("#grant-request-asset-results");
  if (!input || !results) return;

  let timer = null;
  let activeIdx = -1;
  let lastQuery = "";

  const renderResults = (items) => {
    if (!items || items.length === 0) {
      results.hidden = true;
      results.innerHTML = "";
      return;
    }
    results.hidden = false;
    activeIdx = -1;
    results.innerHTML = items.map((a, i) => (
      '<div class="asset-picker-result" data-asset-idx="' + i + '">' +
        '<div class="picker-name">' + safe(a.name || a.id) + '</div>' +
        '<div class="picker-meta">' + safe(a.type || '') + ' · ' + safe(a.env || '') +
          (a.private_ip ? ' · ' + safe(a.private_ip) : '') +
          (a.public_ip ? ' · ' + safe(a.public_ip) : '') +
        '</div>' +
      '</div>'
    )).join("");
    results.querySelectorAll(".asset-picker-result").forEach((node) => {
      node.addEventListener("mousedown", (ev) => {
        ev.preventDefault(); // keep input focus; mousedown fires before blur
        const a = items[parseInt(node.dataset.assetIdx, 10)];
        grantsState.pickedAsset = a;
        input.value = a.name || a.id;
        results.hidden = true;
      });
    });
  };

  const search = async (q) => {
    if (q === lastQuery) return;
    lastQuery = q;
    if (q.length < 2) {
      renderResults([]);
      return;
    }
    try {
      const data = await api("/api/v1/cmdb/assets?limit=20&q=" + encodeURIComponent(q));
      renderResults(data.items || []);
    } catch (_) {
      renderResults([]);
    }
  };

  input.addEventListener("input", () => {
    grantsState.pickedAsset = null; // typing invalidates prior pick
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => search(input.value.trim()), 180);
  });
  input.addEventListener("focus", () => {
    if (lastQuery && results.children.length > 0) results.hidden = false;
  });
  input.addEventListener("blur", () => {
    setTimeout(() => { results.hidden = true; }, 120);
  });
  input.addEventListener("keydown", (ev) => {
    const items = results.querySelectorAll(".asset-picker-result");
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
    } else if (ev.key === "Enter" && activeIdx >= 0 && items[activeIdx]) {
      ev.preventDefault();
      items[activeIdx].dispatchEvent(new MouseEvent("mousedown"));
      return;
    } else if (ev.key === "Escape") {
      results.hidden = true;
      return;
    } else {
      return;
    }
    items.forEach((n, i) => n.classList.toggle("active", i === activeIdx));
  });
}

async function onCancelRequest(id) {
  try {
    await api("/api/v1/bastion/requests/" + encodeURIComponent(id) + "/cancel", { method: "POST" });
    toast("Request cancelled", "success");
    await loadGrantsData();
    renderGrantsView();
  } catch (err) {
    toast("Cancel failed: " + err.message, "error");
  }
}

async function onApproveRequest(id) {
  const reason = prompt("Approve reason (optional):", "") || "";
  try {
    await api("/api/v1/bastion/requests/" + encodeURIComponent(id) + "/approve", {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    toast("Request approved · grant issued", "success");
    logActivity("Approved bastion request " + id, "success");
    await loadGrantsData();
    renderGrantsView();
  } catch (err) {
    toast("Approve failed: " + err.message, "error");
  }
}

async function onRejectRequest(id) {
  const reason = prompt("Reject reason:", "") || "";
  if (!reason) {
    toast("Rejection reason is required", "error");
    return;
  }
  try {
    await api("/api/v1/bastion/requests/" + encodeURIComponent(id) + "/reject", {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    toast("Request rejected", "success");
    await loadGrantsData();
    renderGrantsView();
  } catch (err) {
    toast("Reject failed: " + err.message, "error");
  }
}

async function onRevokeGrant(id) {
  const reason = prompt("Revoke reason:", "no longer needed") || "";
  try {
    await api("/api/v1/bastion/grants/" + encodeURIComponent(id), {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    });
    toast("Grant revoked", "success");
    logActivity("Revoked bastion grant " + id, "success");
    await loadGrantsData();
    renderGrantsView();
  } catch (err) {
    toast("Revoke failed: " + err.message, "error");
  }
}

async function refreshGrantsView() {
  await loadGrantsData();
  renderGrantsView();
}

// openGrantRequestModal pops a small request form pre-filled with an asset.
// Triggered from the connect flow (after a 403 needs_grant response) so users
// don't have to navigate to the Grants page just to ask for access.
function openGrantRequestModal(opts) {
  opts = opts || {};
  const assetID = opts.assetID || "";
  const assetName = opts.assetName || assetID;
  const kindLabel = opts.kind === "rdp" ? "RDP" : "terminal";

  const existing = document.querySelector(".grant-request-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "grant-request-modal";
  modal.innerHTML =
    '<div class="grant-request-backdrop" data-grant-action="close"></div>' +
    '<div class="grant-request-card" role="dialog" aria-label="Request bastion access">' +
      '<div class="grant-request-head">' +
        '<div class="grant-request-title">Request access</div>' +
        '<button class="icon-btn" data-grant-action="close" title="Close">×</button>' +
      '</div>' +
      '<div class="grant-request-body">' +
        '<p class="muted" style="margin: 0 0 12px;">You don\'t have an active grant for ' +
          '<strong>' + safe(assetName) + '</strong>.' +
          ' Submit a request and an approver will issue a time-bounded grant.' +
          ' (' + kindLabel + ' connection)</p>' +
        '<form id="grant-request-modal-form" class="form-grid" style="grid-template-columns: 1fr 1fr; gap: 12px;">' +
          '<div class="field full"><label>Asset</label>' +
            '<input value="' + safe(assetName) + '" disabled />' +
            '<input type="hidden" name="asset_id" value="' + safe(assetID) + '" />' +
          '</div>' +
          '<div class="field"><label>Duration</label>' +
            '<select name="duration_seconds">' +
              '<option value="900">15m</option>' +
              '<option value="1800">30m</option>' +
              '<option value="3600" selected>1h</option>' +
              '<option value="7200">2h</option>' +
              '<option value="14400">4h</option>' +
              '<option value="28800">8h</option>' +
            '</select>' +
          '</div>' +
          '<div class="field"></div>' +
          '<div class="field full"><label>Reason</label>' +
            '<input name="reason" placeholder="Brief justification (visible to approvers)" autofocus />' +
          '</div>' +
          '<div class="form-actions" style="grid-column: 1 / -1;">' +
            '<button type="button" class="btn ghost" data-grant-action="close">Cancel</button>' +
            '<button type="submit" class="btn primary">Submit request</button>' +
          '</div>' +
        '</form>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  const close = () => {
    document.removeEventListener("keydown", onKey);
    modal.remove();
  };
  const onKey = (ev) => { if (ev.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  modal.addEventListener("click", (ev) => {
    if (ev.target.dataset && ev.target.dataset.grantAction === "close") close();
  });

  const form = modal.querySelector("#grant-request-modal-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const reason = String(data.get("reason") || "").trim();
    const duration = parseInt(String(data.get("duration_seconds") || "3600"), 10) || 3600;
    if (!assetID) {
      toast("Missing asset id", "error");
      return;
    }
    try {
      await api("/api/v1/bastion/requests", {
        method: "POST",
        body: JSON.stringify({ asset_id: assetID, reason, duration_seconds: duration }),
      });
      toast("Request submitted · waiting for approval", "success");
      logActivity("Submitted bastion request for " + (assetName || assetID), "success");
      close();
    } catch (err) {
      toast("Submit failed: " + err.message, "error");
    }
  });

  // Focus the reason input so power users can type-and-submit immediately.
  setTimeout(() => {
    const input = form.querySelector('input[name="reason"]');
    if (input) input.focus();
  }, 0);
}

// handleConnectError is the connect-flow companion: returns true if the err
// was a needs_grant 403 (and opens the modal); false otherwise so callers
// can fall back to a regular toast.
function handleConnectError(err, asset, kind) {
  if (err && err.status === 403 && err.payload && err.payload.needs_grant) {
    openGrantRequestModal({
      assetID: (err.payload && err.payload.asset_id) || (asset && asset.id) || "",
      assetName: (asset && (asset.name || asset.id)) || (err.payload && err.payload.asset_id) || "",
      kind,
    });
    return true;
  }
  return false;
}
