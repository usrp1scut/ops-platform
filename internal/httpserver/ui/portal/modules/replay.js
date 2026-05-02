// Asciinema cast v2 replay using xterm.js (already vendored).
//
// Format spec: https://docs.asciinema.org/manual/asciicast/v2/
//   header: {"version":2,"width":W,"height":H,"timestamp":T,"env":{...}}
//   frame:  [seconds_since_start, "o", data]
//
// Depends on: state.token (auth), toast (user feedback), safe (HTML escape).
// xterm.js + FitAddon must be loaded before this script.

async function openReplayModal(sessionID, label) {
  if (!sessionID) return;
  let castText;
  try {
    const resp = await fetch("/api/v1/cmdb/sessions/" + encodeURIComponent(sessionID) + "/recording", {
      headers: state.token ? { Authorization: "Bearer " + state.token } : {},
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(resp.status + " " + (body || resp.statusText));
    }
    castText = await resp.text();
  } catch (err) {
    toast("Recording fetch failed: " + err.message, "error");
    return;
  }

  const lines = castText.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    toast("Recording is empty", "error");
    return;
  }
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch (_) {
    toast("Invalid recording header", "error");
    return;
  }
  if (header.version !== 2) {
    toast("Unsupported cast version " + header.version, "error");
    return;
  }
  const frames = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      const f = JSON.parse(lines[i]);
      if (Array.isArray(f) && f.length >= 3 && f[1] === "o") {
        frames.push(f);
      }
    } catch (_) { /* skip malformed lines; recording is best-effort */ }
  }

  const cols = header.width || 80;
  const rows = header.height || 24;
  const totalSeconds = frames.length > 0 ? frames[frames.length - 1][0] : 0;

  const modal = document.createElement("div");
  modal.className = "replay-modal";
  modal.innerHTML =
    '<div class="replay-backdrop" data-replay-action="close"></div>' +
    '<div class="replay-card" role="dialog" aria-label="Session replay">' +
      '<div class="replay-head">' +
        '<div class="replay-title">' + safe(label || sessionID) +
          ' <span class="replay-meta">' + cols + '×' + rows +
          ' · ' + totalSeconds.toFixed(1) + 's · ' + frames.length + ' frames</span>' +
        '</div>' +
        '<div class="replay-actions">' +
          '<button class="btn ghost" data-replay-action="restart">Restart</button>' +
          '<button class="btn ghost" data-replay-action="speed">1×</button>' +
          '<button class="btn ghost" data-replay-action="close">Close</button>' +
        '</div>' +
      '</div>' +
      '<div class="replay-body" id="replay-host"></div>' +
    '</div>';
  document.body.appendChild(modal);

  const host = modal.querySelector("#replay-host");
  const term = new Terminal({
    rows,
    cols,
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
    theme: { background: "#0e1116", foreground: "#e6e8eb" },
    convertEol: true,
    scrollback: 5000,
    disableStdin: true,
  });
  term.open(host);

  let speed = 1;
  let cancelled = false;
  let timerId = null;

  function clearTimer() {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  }

  function play() {
    clearTimer();
    term.reset();
    if (frames.length === 0) return;
    let idx = 0;
    function step() {
      if (cancelled || idx >= frames.length) return;
      const f = frames[idx++];
      term.write(f[2]);
      if (idx < frames.length) {
        const dt = (frames[idx][0] - f[0]) * 1000 / speed;
        timerId = setTimeout(step, Math.max(dt, 0));
      }
    }
    step();
  }

  modal.addEventListener("click", (ev) => {
    const action = ev.target && ev.target.dataset && ev.target.dataset.replayAction;
    if (action === "close") {
      cancelled = true;
      clearTimer();
      try { term.dispose(); } catch (_) {}
      modal.remove();
    } else if (action === "restart") {
      cancelled = false;
      play();
    } else if (action === "speed") {
      speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
      ev.target.textContent = speed + "×";
    }
  });

  // Esc closes the modal.
  const onKey = (ev) => {
    if (ev.key === "Escape") {
      cancelled = true;
      clearTimer();
      try { term.dispose(); } catch (_) {}
      modal.remove();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);

  play();
}
