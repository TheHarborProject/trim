"use client";

// @theharborproject/trim/react/controls/toggle-action — Trim's default
// renderer for a "toggle-action" control (a single interactive element with
// a persistent boolean pressed state — the WAI-ARIA "toggle button"
// pattern). Hook-free, props-in/JSX-out — see ./boolean.tsx's header for the
// shared rationale.
//
// Moved from ../../advanced/widgets.tsx (formerly ToggleActionWidget) —
// that file now re-exports this implementation under its original name, so
// existing `@theharborproject/trim/advanced` imports keep working
// unchanged.

import type { TrimControlRendererProps } from "../renderer-contract";

export function DefaultToggleActionControl({ control, value, setValue }: TrimControlRendererProps<boolean>) {
  return (
    <button type="button" data-trim-control data-trim-kind="toggle-action" aria-pressed={Boolean(value)} onClick={() => setValue(!value)}>
      {control.description ?? control.label}
    </button>
  );
}
