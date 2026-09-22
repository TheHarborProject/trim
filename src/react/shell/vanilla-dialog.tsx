"use client";

// @theharborproject/trim/react/shell — the "vanilla" + "dialog" shell: a
// simple centered modal with a backdrop. Deliberately minimal — no
// focus-trap library dependency, no animation (see
// ../../themes/default.css, which never uses `animation:`/`transition:`
// anywhere in this package's optional stylesheet). Shares its
// Escape/click-outside logic with ../shell/vanilla-popover.tsx via
// ./use-shell-dismiss.ts; a backdrop pointerdown is "outside" the dialog
// panel the same way a popover's outside-click is, so no separate backdrop
// click handler is needed.
//
// `open` starts as a prop, never read from window/matchMedia/localStorage at
// render time (SSR/hydration safety) — see ./vanilla-popover.tsx's header
// for the same note.

import { useEffect, useId, useRef } from "react";
import type { TrimShellProps } from "../config";
import { useTrimShellDismiss } from "./use-shell-dismiss";

export type VanillaDialogShellProps = TrimShellProps & {
  /** Accessible name for the launcher button. Defaults to a generic label — never hardcoded copy about any specific setting domain. */
  label?: string;
};

export function VanillaDialogShell({ children, open, onOpenChange, label = "Settings" }: VanillaDialogShellProps) {
  const dialogId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useTrimShellDismiss(open, onOpenChange, panelRef, launcherRef);

  // Focus moves into the dialog on open, and back to the launcher on close
  // — but only on an actual open->close transition, never on the initial
  // (closed) mount, which would otherwise steal focus to the launcher for
  // no reason the moment the panel mounts.
  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      launcherRef.current?.focus();
      wasOpenRef.current = false;
    }
  }, [open]);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        data-trim-shell-launcher
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label={label}
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open && (
        <div data-trim-shell-dialog-backdrop>
          <div ref={panelRef} id={dialogId} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} data-trim-shell-dialog>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
