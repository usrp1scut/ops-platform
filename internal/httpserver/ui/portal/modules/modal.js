// Generic modal primitive. Replaces the ad-hoc replay/grant-request modals
// over time and gives Phase 2+ Assets/Platform forms a consistent surface.
//
// Usage:
//   const close = openModal({
//     title: "Create asset",
//     body: someHTMLOrNode,             // string or HTMLElement
//     size: "md",                       // "sm" | "md" | "lg"; default "md"
//     dismissible: true,                // backdrop click + Esc close
//     onClose: () => {},                // fired after the modal is removed
//     actions: [                        // rendered in the footer, left-to-right
//       { label: "Cancel", variant: "ghost", onClick: ({close}) => close() },
//       { label: "Create", variant: "primary", onClick: async (ctx) => { … } },
//     ],
//   });
//
// Each action handler receives a context with { close, root, setBusy(label) }.
// setBusy disables the action buttons and shows the given label on the active
// button until the handler resolves — covers the common "submitting…" pattern.

const MODAL_SIZE_CLASS = { sm: "modal-sm", md: "modal-md", lg: "modal-lg" };

function openModal(opts) {
  opts = opts || {};
  const size = MODAL_SIZE_CLASS[opts.size] || MODAL_SIZE_CLASS.md;
  const dismissible = opts.dismissible !== false;

  const previouslyFocused = document.activeElement;

  const root = document.createElement("div");
  root.className = "ui-modal";
  root.innerHTML =
    '<div class="ui-modal-backdrop" data-ui-modal-action="dismiss"></div>' +
    '<div class="ui-modal-card ' + size + '" role="dialog" aria-modal="true">' +
      '<div class="ui-modal-head">' +
        '<div class="ui-modal-title">' + safe(opts.title || "") + "</div>" +
        '<button type="button" class="icon-btn" data-ui-modal-action="dismiss" aria-label="Close" title="Close">×</button>' +
      "</div>" +
      '<div class="ui-modal-body"></div>' +
      '<div class="ui-modal-foot"></div>' +
    "</div>";
  document.body.appendChild(root);

  const card = root.querySelector(".ui-modal-card");
  const bodyMount = root.querySelector(".ui-modal-body");
  const footMount = root.querySelector(".ui-modal-foot");

  if (opts.body instanceof Node) {
    bodyMount.appendChild(opts.body);
  } else if (typeof opts.body === "string") {
    bodyMount.innerHTML = opts.body;
  }

  // Render actions. Buttons close over the action object so we can find the
  // active one when setBusy is called.
  const buttons = [];
  (opts.actions || []).forEach((action) => {
    const btn = document.createElement("button");
    btn.type = action.type || "button";
    btn.className = "btn " + (action.variant || "ghost");
    btn.textContent = action.label || "";
    btn._action = action;
    if (action.id) btn.id = action.id;
    btn.addEventListener("click", () => runAction(action, btn));
    footMount.appendChild(btn);
    buttons.push(btn);
  });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    root.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      try { previouslyFocused.focus(); } catch (_) {}
    }
    if (typeof opts.onClose === "function") opts.onClose();
  }

  function setBusy(activeBtn, label) {
    buttons.forEach((b) => { b.disabled = !!label; });
    if (activeBtn) {
      if (label) {
        activeBtn._origLabel = activeBtn.textContent;
        activeBtn.textContent = label;
      } else if (activeBtn._origLabel) {
        activeBtn.textContent = activeBtn._origLabel;
      }
    }
  }

  async function runAction(action, btn) {
    if (!action || typeof action.onClick !== "function") return;
    const ctx = {
      close,
      root,
      setBusy: (label) => setBusy(btn, label),
    };
    try {
      await action.onClick(ctx);
    } catch (err) {
      // Errors bubble up to the caller via toast — the modal itself stays
      // open so the user can correct input.
      try { toast("" + (err && err.message ? err.message : err), "error"); } catch (_) {}
      setBusy(btn, null);
    }
  }

  function onKey(ev) {
    if (!dismissible) return;
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
    }
  }
  document.addEventListener("keydown", onKey);

  if (dismissible) {
    root.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t && t.dataset && t.dataset.uiModalAction === "dismiss") close();
    });
  }

  // Focus discipline: focus the first input/button inside the body, falling
  // back to the close-action button if none.
  setTimeout(() => {
    const focusTarget =
      card.querySelector("[autofocus], input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled])") ||
      card.querySelector(".ui-modal-foot .btn.primary") ||
      card.querySelector('[data-ui-modal-action="dismiss"]');
    if (focusTarget) try { focusTarget.focus(); } catch (_) {}
  }, 0);

  return close;
}
