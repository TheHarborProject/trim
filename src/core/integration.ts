// Trim — integration & control types. Framework-agnostic: no React import.
//
// A "control" is a declarative description of one adjustable value — shape
// only, no rendering, no direct state. A "binding" (see bindings.ts) is how
// its value is actually read/written/observed. An "integration" (TrimCore) is
// just {id, meta, controls} — a flat, serializable descriptor a registry can
// hold and a panel can render, however it was built (JSX parsing in
// @theharborproject/trim/react's components.tsx, or by hand).

import type { TrimBinding } from "./bindings";

export type TrimIntegrationMeta = {
  label: string;
  description?: string;
  group?: string;
  order?: number;
};

export type TrimControlKind = "toggle" | "segmented" | "slider" | "action" | "toggle-action" | "custom";

interface TrimControlBase<Kind extends TrimControlKind, V> {
  id: string;
  kind: Kind;
  label: string;
  description?: string;
  binding: TrimBinding<V>;
  // Whether this control may be composed into a layout more than once.
  // Left undefined rather than defaulted here — nothing in the runtime
  // (registry, resolution, renderers) reads this field; it exists for a
  // future composition/CLI layer, which treats an absent value as `true`.
  // Stamping a literal default onto every control object would be a cost
  // (one more key, forever) paid for a default that "absent means true" at
  // the one or two call sites that actually care already expresses for free.
  is_unique?: boolean;
}

export type ToggleControl = TrimControlBase<"toggle", boolean>;

// `label` is opaque here on purpose — the core has no notion of "React node".
// @theharborproject/trim/react's parser fills it with a ReactNode (JSX
// children of <Trim.Option>); a non-JSX caller could just as well put a
// plain string here.
export type SegmentedOption<V extends string = string> = { value: V; label: unknown };
export type SegmentedControl<V extends string = string> = TrimControlBase<"segmented", V> & {
  options: readonly SegmentedOption<V>[];
};

export type SliderControl = TrimControlBase<"slider", number> & { min: number; max: number; step?: number };
export type ActionControl = TrimControlBase<"action", void>;
// A single interactive element with a persistent boolean pressed/active
// state — the WAI-ARIA "toggle button" pattern (aria-pressed), distinct from
// "toggle" (a renderer's convention may render that as a two-way segmented
// pair) and from "action" (binding value void: fire-and-forget, no
// persistent state to reflect). Generic — nothing here or in any renderer
// branch for it may know about a specific host control.
export type ToggleActionControl = TrimControlBase<"toggle-action", boolean>;
export type CustomControl<V = unknown> = TrimControlBase<"custom", V>;

export type TrimControl<V = unknown> =
  | ToggleControl
  | SegmentedControl<string>
  | SliderControl
  | ActionControl
  | ToggleActionControl
  | CustomControl<V>;

/** A flat, serializable integration descriptor — what a registry stores and a panel reads. */
export type TrimCore = {
  id: string;
  meta: TrimIntegrationMeta;
  controls: Record<string, TrimControl>;
};
