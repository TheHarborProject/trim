"use client";

// @theharborproject/trim/react/shell — the "vanilla" + "popover" shell: a
// floating launcher button (bottom-right fixed by default) that toggles an
// anchored bubble near itself — not centered, not a drawer/aside. Styled
// only through the same `--trim-*` custom properties + data-trim-* attribute
// convention as the rest of this package's default renderer (see
// ../../themes/default.css's [data-trim-shell-launcher]/[data-trim-shell-popover]
// rules) — no branding, no host token, no CSS import from this file itself.
//
// `open` starts as a prop, never read from window/matchMedia/localStorage at
// render time (SSR/hydration safety — this file may run in a Next.js host).
// The only browser-only work (the outside-click/Escape listeners) happens in
// ./use-shell-dismiss.ts, entirely inside a useEffect, so it never runs
// during server rendering or the first client render.

import { useId, useRef } from "react";
import type { TrimShellProps } from "../config";
import { useTrimShellDismiss } from "./use-shell-dismiss";

export type VanillaPopoverShellProps = TrimShellProps & {
  /** Accessible name for the launcher button. Defaults to a generic label — never hardcoded copy about any specific setting domain. */
  label?: string;
};

export function VanillaPopoverShell({ children, open, onOpenChange, label = "Settings" }: VanillaPopoverShellProps) {
  const popoverId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useTrimShellDismiss(open, onOpenChange, popoverRef, launcherRef);

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        data-trim-shell-launcher
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={label}
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open && (
        <div ref={popoverRef} id={popoverId} role="dialog" aria-label={label} data-trim-shell-popover>
          {children}
        </div>
      )}
    </>
  );
}
