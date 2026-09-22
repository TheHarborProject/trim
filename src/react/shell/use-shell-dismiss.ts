"use client";

// Internal sibling of ./vanilla-popover.tsx and ./vanilla-dialog.tsx. Not
// part of any public entry point — no package.json export subpath points at
// this file's path directly (same pattern as
// ../layouts/render-resolved-control.tsx). Escape-to-close and
// click-outside-to-close are genuinely the same logic in both built-in
// shells, so it's extracted here rather than duplicated.

import { useEffect, type RefObject } from "react";

/**
 * Attaches document-level `keydown` (Escape) and `pointerdown`
 * (click-outside) listeners ONLY while `open` — nothing is ever attached
 * while closed, and every add is paired with the identical remove in the
 * same effect's cleanup, so this is safe under React Strict Mode's
 * dev-only double-invoke (mount -> cleanup -> mount): no leaked listener,
 * no double-fire.
 *
 * `containerRef` is the shell's own presented surface (the popover bubble,
 * the dialog panel) — a pointerdown inside it never counts as "outside".
 * `launcherRef`, if given, is excluded the same way: the launcher's own
 * `onClick` already toggles `open`, and without this exclusion a single
 * click on the launcher while open would both toggle (via onClick) and
 * dismiss (via this handler) in the same interaction.
 */
export function useTrimShellDismiss(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  containerRef: RefObject<HTMLElement | null>,
  launcherRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      if (launcherRef?.current?.contains(target)) return;
      onOpenChange(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, onOpenChange, containerRef, launcherRef]);
}
