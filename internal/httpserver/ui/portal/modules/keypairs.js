// SSH keypair management module.
// Depends on: api, state.keypairs, state.keypairForm, writeAccess, safe,
// relativeTime, toast, logActivity (all defined in app.js).

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
