// @theharborproject/trim/react/controls/unsupported-fallback — Trim's
// fallback for a control kind the default renderer has no widget for (e.g.
// "slider", "action", "custom" today). Not shaped like TrimControlRendererProps
// — there is no value/setValue to bind, only a control to report. Hook-free,
// called directly to verify it warns and returns null rather than throwing.
//
// No "use client": unlike its siblings in this directory, it attaches no
// event handler and calls no hook — a console.error side effect plus a null
// return works identically on the server, so it carries none of the
// directives its interactive neighbors need under the RSC convention.
//
// Moved from ../../advanced/widgets.tsx — that file now re-exports this
// implementation under its original name, so existing
// `@theharborproject/trim/advanced` imports keep working unchanged.

import type { TrimControl } from "../../core/integration";

export function UnsupportedKindFallback({ control }: { control: TrimControl }) {
  if (process.env.NODE_ENV !== "production") {
    console.error(`Trim: <Trim.Panel>'s default renderer has no widget for control kind "${control.kind}" (control "${control.id}"). Provide a custom renderer for it, or leave it out of your own panel.`);
  }
  return null;
}
