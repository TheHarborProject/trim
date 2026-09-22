"use client";

// @theharborproject/trim/react/shell — the "vanilla" + "inline" shell, and
// what "shadcn" and "headless" resolve to as well, regardless of their own
// `shell` value (see ./resolve.ts) — this runtime never renders anything
// shadcn- or headless-specific; that chrome is CLI-generated, host-local
// code, entirely out of this package's scope.
//
// Renders `children` exactly where the panel is mounted: no launcher, no
// overlay, no wrapper element of any kind. This must stay byte-for-byte
// identical to how <Trim.Panel config={...}> rendered before `ui` existed —
// see ../config.ts's TrimConfig.ui comment and ../panel.tsx's
// ConfiguredPanel, which renders straight through this component by
// default (`ui` omitted resolves here — see ./resolve.ts).

import type { TrimShellProps } from "../config";

/** `open`/`onOpenChange` are accepted (the shared TrimShellProps contract) but unused — inline has no interactive chrome to control. */
export function VanillaInlineShell({ children }: TrimShellProps) {
  return <>{children}</>;
}
