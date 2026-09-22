// No "use client" — like ../config.ts's resolveTrimGroups, this is a plain
// function returning component references, never a hook and never JSX
// itself (see ./vanilla-inline.tsx/./vanilla-popover.tsx/./vanilla-dialog.tsx
// for the actual "use client" component implementations).
//
// @theharborproject/trim/react/shell — resolves a TrimConfig's `ui` field
// (see ../config.ts) to the shell component that wraps a config-driven
// panel's rendered layout — the mirror, for shells, of how ../panel.tsx's
// ConfiguredPanel itself picks a `layout` component ("sections" ->
// DefaultSectionsLayout, otherwise the host's own function). Called from
// ConfiguredPanel with `config.ui?.adapter` / `config.ui?.shell` — never
// exported through ../index.ts (see this subpath's own package.json export
// entry instead), the same non-barrel convention ../layouts/sections.tsx's
// DefaultSectionsLayout already uses.

import type { ComponentType } from "react";
import type { TrimShellProps, TrimUIAdapter, TrimShell } from "../config";
import { VanillaInlineShell } from "./vanilla-inline";
import { VanillaPopoverShell } from "./vanilla-popover";
import { VanillaDialogShell } from "./vanilla-dialog";

/**
 * Defaults: `adapter ?? "vanilla"`, `shell ?? "inline"` — an omitted `ui`
 * field (or an omitted `ui.adapter`/`ui.shell`) resolves here to exactly
 * `VanillaInlineShell`, the 0.1-compatible passthrough with no wrapper
 * element at all.
 *
 * "shadcn" and "headless" resolve to that same passthrough regardless of
 * `shell` — their chrome is CLI-generated, host-local code (see `trim add`),
 * never rendered by this runtime.
 */
export function resolveShell(adapter: TrimUIAdapter | undefined, shell: TrimShell | undefined): ComponentType<TrimShellProps> {
  if ((adapter ?? "vanilla") !== "vanilla") return VanillaInlineShell;
  switch (shell ?? "inline") {
    case "popover":
      return VanillaPopoverShell;
    case "dialog":
      return VanillaDialogShell;
    case "inline":
    default:
      return VanillaInlineShell;
  }
}
