"use client";

import { useEffect, useRef } from "react";

/**
 * Modal behaviour that every dialog in the dashboard was missing: Escape to close, focus moved into
 * the panel on open and restored to the trigger on close, a focus trap, and a body scroll lock.
 *
 * Without these, a dialog is only visually modal. Measured before this existed: opening the
 * new-appointment modal left focus on the trigger, Escape did nothing, the page scrolled behind the
 * overlay, and the first Tab landed on a button *behind* the dialog — so a keyboard or screen-reader
 * user was never actually in it.
 *
 * Attach the returned ref to the panel (not the backdrop), and pair it with
 * `role="dialog" aria-modal="true"` plus an accessible name.
 *
 * `open` exists because some dialogs are rendered inline as `{editing && <div…>}` inside an
 * always-mounted parent. Those can't call the hook conditionally, so they pass the same condition
 * here — otherwise the effect would run on the parent's mount and lock body scroll for good.
 * Dialogs that are their own component (mounted only while open) can leave it defaulted.
 */
export function useDialog<T extends HTMLElement = HTMLElement>(onClose: () => void, open = true) {
  const ref = useRef<T>(null);
  // Kept in a ref so changing the handler identity doesn't tear down the listeners mid-dialog.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed"
      );

    // Focus the first control rather than the panel itself, so screen readers land on something
    // actionable. Falls back to the panel (needs tabIndex={-1}) when the dialog has no controls yet.
    const first = focusable()[0];
    (first ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at both ends, and pull focus back in if it somehow escaped the panel.
      if (e.shiftKey && (active === firstItem || !panel.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (active === lastItem || !panel.contains(active))) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Only restore focus if it's still inside the closing dialog — otherwise the user has
      // already moved on and yanking focus back would be the disruptive thing.
      if (!document.activeElement || document.activeElement === document.body) {
        previouslyFocused?.focus?.();
      }
    };
  }, [open]);

  return ref;
}
