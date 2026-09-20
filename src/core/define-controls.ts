// Trim — pure control-definition factories. Framework-agnostic: no React
// import, no I/O, no runtime behavior beyond stamping each control's `kind`
// discriminant onto the fields the caller provides.
//
// These exist purely for inference and to prevent invalid configurations —
// defineSegmentedControl always requires `options`, defineActionControl
// never accepts them, etc. — not to introduce a second control model. The
// object each one returns is a plain TrimControl, identical in shape to what
// @theharborproject/trim/react's JSX parser (components.tsx) already builds
// from <Trim.Toggle>/<Trim.Segmented>/<Trim.ToggleAction> elements. Neither
// authoring path is privileged: both converge on the same TrimControl shape
// before the registry or any renderer ever sees it.
//
// `is_unique` is passed through exactly as given, never defaulted here — see
// TrimControlBase's own comment in ./integration.

import type { ActionControl, SegmentedControl, ToggleActionControl, ToggleControl } from "./integration";

type ControlInput<C> = Omit<C, "kind">;

export function defineBooleanControl(control: ControlInput<ToggleControl>): ToggleControl {
  return { ...control, kind: "toggle" };
}

export function defineSegmentedControl<V extends string>(control: ControlInput<SegmentedControl<V>>): SegmentedControl<V> {
  return { ...control, kind: "segmented" };
}

export function defineActionControl(control: ControlInput<ActionControl>): ActionControl {
  return { ...control, kind: "action" };
}

export function defineToggleActionControl(control: ControlInput<ToggleActionControl>): ToggleActionControl {
  return { ...control, kind: "toggle-action" };
}
