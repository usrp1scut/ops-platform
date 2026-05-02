// Bastions view module.
// Depends on: api, state.bastions, state.bastionQuery, hasPermission,
// safe, sourcePill, openAssetDrawer, connectAssetFromList, setView,
// logActivity (all defined in app.js).

function buildBastionQueryString() {
  const q = state.bastionQuery;
  const parts = ["is_vpc_proxy=true", "limit=500", "offset=0"];
  const add = (k, v) => {
    if (v === undefined || v === null || v === "") return;
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  };
  add("env", q.env);
  add("region", q.region);
  add("status", q.status);
  add("q", q.q);
  return "?" + parts.join("&");
}

async function refreshBastions() {
  if (!hasPermission("cmdb.asset:read")) {
    state.bastions = [];
    renderBastionsView();
    return;
  }
  try {
    const data = await api("/api/v1/cmdb/assets" + buildBastionQueryString());
    state.bastions = (data.items || []).slice().sort((a, b) => {
      const ea = String(a.env || "").localeCompare(String(b.env || ""));
      if (ea !== 0) return ea;
      return String(a.name || a.id || "").localeCompare(String(b.name || b.id || ""));
    });
    renderBastionsView();
  } catch (error) {
    state.bastions = [];
    renderBastionsView();
    logActivity("Failed to load bastions: " + error.message, "error");
  }
}

function renderBastionsView() {
  const tbody = document.getElementById("bastions-table-body");
  const hint = document.getElementById("bastions-count-hint");
  if (!tbody) return;
  const items = state.bastions || [];
  if (hint) {
    hint.textContent = items.length === 0
      ? "No bastions found."
      : items.length + (items.length === 1 ? " bastion" : " bastions");
  }
  populateBastionFilterOptions();
  if (items.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="empty-row">' +
      'No bastions registered. Promote an EC2 instance from the <a href="#" data-nav="cmdb">Assets</a> page to use it as a jump host.' +
      "</td></tr>";
    return;
  }
  tbody.innerHTML = items
    .map((asset) => {
      const probeStatus = asset.last_probe_status || "";
      const probeCls = probeStatus === "ok"
        ? "status-pill ok"
        : probeStatus === "fail" ? "status-pill error" : "status-pill muted";
      const probeLabel = probeStatus
        ? safe(probeStatus)
        : '<span class="muted">never</span>';
      const vpc = asset.vpc_id ? safe(asset.vpc_id) : '<span class="muted">—</span>';
      const pub = asset.public_ip ? safe(asset.public_ip) : '<span class="muted">—</span>';
      const priv = asset.private_ip ? safe(asset.private_ip) : '<span class="muted">—</span>';
      return (
        '<tr data-bastion-id="' + safe(asset.id) + '">' +
        '<td><a href="#" class="asset-link" data-bastion-open="' + safe(asset.id) + '">' + safe(asset.name || asset.id) + "</a></td>" +
        "<td>" + safe(asset.env || "—") + "</td>" +
        "<td>" + vpc + "</td>" +
        "<td>" + safe(asset.region || "—") + "</td>" +
        "<td>" + pub + "</td>" +
        "<td>" + priv + "</td>" +
        '<td><span class="' + probeCls + '">' + probeLabel + "</span></td>" +
        "<td>" + sourcePill(asset.source) + "</td>" +
        '<td class="row-actions-cell">' +
        '<button class="btn ghost small" data-bastion-connect="' + safe(asset.id) + '" title="Open terminal">Connect</button> ' +
        '<button class="btn ghost small" data-bastion-open="' + safe(asset.id) + '" title="Details">Details</button>' +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
}

function populateBastionFilterOptions() {
  const envSel = document.getElementById("bastion-filter-env");
  const regionSel = document.getElementById("bastion-filter-region");
  const statusSel = document.getElementById("bastion-filter-status");
  if (!envSel || !regionSel || !statusSel) return;
  const envs = new Set();
  const regions = new Set();
  const statuses = new Set();
  for (const b of state.bastions || []) {
    if (b.env) envs.add(b.env);
    if (b.region) regions.add(b.region);
    if (b.status) statuses.add(b.status);
  }
  const fill = (sel, values, selected, allLabel) => {
    const prev = sel.value;
    sel.innerHTML =
      '<option value="">' + allLabel + "</option>" +
      [...values].sort().map((v) => '<option value="' + safe(v) + '">' + safe(v) + "</option>").join("");
    if (selected) sel.value = selected;
    else if (prev) sel.value = prev;
  };
  fill(envSel, envs, state.bastionQuery.env, "All envs");
  fill(regionSel, regions, state.bastionQuery.region, "All regions");
  fill(statusSel, statuses, state.bastionQuery.status, "All statuses");
}

function bindBastionsEvents() {
  const search = document.getElementById("bastion-search");
  const refresh = document.getElementById("refresh-bastions-btn");
  const reset = document.getElementById("bastion-filter-reset-btn");
  const envSel = document.getElementById("bastion-filter-env");
  const regionSel = document.getElementById("bastion-filter-region");
  const statusSel = document.getElementById("bastion-filter-status");
  const tbody = document.getElementById("bastions-table-body");

  if (search && !search.dataset.bound) {
    search.dataset.bound = "1";
    let timer = null;
    search.addEventListener("input", () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        state.bastionQuery.q = search.value.trim();
        refreshBastions();
      }, 180);
    });
  }
  if (refresh && !refresh.dataset.bound) {
    refresh.dataset.bound = "1";
    refresh.addEventListener("click", () => refreshBastions());
  }
  if (reset && !reset.dataset.bound) {
    reset.dataset.bound = "1";
    reset.addEventListener("click", () => {
      state.bastionQuery = { env: "", region: "", status: "", q: "" };
      if (search) search.value = "";
      refreshBastions();
    });
  }
  [
    [envSel, "env"],
    [regionSel, "region"],
    [statusSel, "status"],
  ].forEach(([sel, key]) => {
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = "1";
    sel.addEventListener("change", () => {
      state.bastionQuery[key] = sel.value;
      refreshBastions();
    });
  });
  if (tbody && !tbody.dataset.bound) {
    tbody.dataset.bound = "1";
    tbody.addEventListener("click", (event) => {
      const nav = event.target.closest("[data-nav]");
      if (nav) {
        event.preventDefault();
        setView(nav.dataset.nav);
        return;
      }
      const open = event.target.closest("[data-bastion-open]");
      if (open) {
        event.preventDefault();
        openAssetDrawer(open.getAttribute("data-bastion-open"));
        return;
      }
      const connect = event.target.closest("[data-bastion-connect]");
      if (connect) {
        event.preventDefault();
        connectAssetFromList(connect.getAttribute("data-bastion-connect"));
      }
    });
  }
}
