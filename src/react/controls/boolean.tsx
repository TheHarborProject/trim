"use client";

// @theharborproject/trim/react/controls/boolean — Trim's default renderer
// for a "toggle" (boolean) control. Hook-free: value/setValue arrive as
// props (see ../renderer-contract's TrimControlRendererProps), so it can be
// called directly in a test, or reused by a custom renderer that wants
// Trim's own toggle markup without anything else. "use client" only because
// it attaches a real onChange handler — an interactive component must be a
// Client Component under the RSC convention regardless of hook usage.
//
// Moved from ../../advanced/widgets.tsx (formerly ToggleWidget) — that file
// now re-exports this implementation under its original name, so existing
// `@theharborproject/trim/advanced` imports keep working unchanged. No
// registry, no binding resolution, no global state: everything this needs
// is already resolved by the caller.

import type { TrimControlRendererProps } from "../renderer-contract";

export function DefaultBooleanControl({ control, value, setValue }: TrimControlRendererProps<boolean>) {
  return (
    <label data-trim-control data-trim-kind="toggle">
      <span data-trim-control-label>{control.label}</span>
      <input type="checkbox" checked={Boolean(value)} onChange={event => setValue(event.target.checked)} />
    </label>
  );
}
