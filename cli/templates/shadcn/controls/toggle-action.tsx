"use client";

// Installed by `trim add @shadcn/controls/toggle-action`. Host-owned from
// this point on. Uses your project's own shadcn Toggle component (see
// components.json's "ui" alias) — Radix's Toggle IS the WAI-ARIA "toggle
// button" pattern (a single element with a persistent pressed/aria-pressed
// state), the exact semantics
// @theharborproject/trim/react/controls/toggle-action's own default
// renderer implements by hand with a plain <button aria-pressed>. `pressed`/
// `onPressedChange` map directly onto value/setValue with no adaptation
// needed — no simplification into a plain boolean toggle, and no ARIA added
// here redundantly: Radix's Toggle already sets aria-pressed itself.
import { Toggle } from "__TRIM_SHADCN_UI_IMPORT__/toggle";
import type { TrimControlRendererProps } from "@theharborproject/trim/react";

export function ShadcnToggleActionControl({ control, value, setValue }: TrimControlRendererProps<boolean>) {
  return (
    <Toggle pressed={Boolean(value)} onPressedChange={setValue}>
      {control.description ?? control.label}
    </Toggle>
  );
}
