import { useEffect, useRef } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  });
}

/**
 * Focus management for aria-modal dialogs: initial focus, Esc-to-close,
 * Tab focus trap inside the panel, and focus restore to the element that
 * was active when the modal opened.
 *
 * Attach `panelRef` to the modal card and `closeButtonRef` to the primary
 * close affordance. If the close button isn't rendered (e.g. permission
 * gated), focus falls back to the panel itself.
 */
export function useModalFocus<TPanel extends HTMLElement = HTMLDivElement>(
  isOpen: boolean,
  onClose: () => void,
) {
  const panelRef = useRef<TPanel | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const restoreTarget = (document.activeElement as HTMLElement | null) || null;

    const focusTimer = window.setTimeout(() => {
      if (closeButtonRef.current) {
        closeButtonRef.current.focus();
      } else {
        panelRef.current?.focus();
      }
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const candidates = focusableElements(panel);
      if (candidates.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = candidates[0];
      const last = candidates[candidates.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first || !panel.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      if (restoreTarget && document.contains(restoreTarget)) {
        window.setTimeout(() => restoreTarget.focus(), 0);
      }
    };
  }, [isOpen]);

  return { panelRef, closeButtonRef };
}
