"use client";

// Trim — individual control-kind widgets, the only place that knows about
// specific control kinds. Each calls no hook of its own (value/setValue come
// in as props) — called directly as a plain function in a test, or reused by
// a custom renderer that wants Trim's own toggle/segmented/toggle-action
// markup without the rest of <Trim.Panel>'s auto-discovery/grouping.
//
// "use client": not because of a hook, but because each one attaches a real
// event handler (onChange/onClick) — an interactive component must be a
// Client Component under the RSC convention regardless of hook usage.
// @theharborproject/trim/react's <Trim.Panel> (panel.tsx) is built on these.

import type { ReactNode } from "react";
import type { TrimControl } from "../core/integration";

export function ToggleWidget({ control, value, setValue }: { control: TrimControl<boolean>; value: boolean | undefined; setValue: (v: boolean) => void }) {
  return (
    <label data-trim-control data-trim-kind="toggle">
      <span data-trim-control-label>{control.label}</span>
      <input type="checkbox" checked={Boolean(value)} onChange={event => setValue(event.target.checked)} />
    </label>
  );
}

export function SegmentedWidget({ groupName, control, value, setValue }: { groupName: string; control: TrimControl<string>; value: string | undefined; setValue: (v: string) => void }) {
  if (control.kind !== "segmented") return null;
  return (
    <fieldset data-trim-control data-trim-kind="segmented">
      <legend data-trim-control-label>{control.label}</legend>
      {control.options.map(option => (
        <label key={String(option.value)} data-trim-option>
          <input
            type="radio"
            name={groupName}
            checked={value === option.value}
            onChange={() => setValue(option.value)}
          />
          <span>{option.label as ReactNode}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function ToggleActionWidget({ control, value, setValue }: { control: TrimControl<boolean>; value: boolean | undefined; setValue: (v: boolean) => void }) {
  return (
    <button type="button" data-trim-control data-trim-kind="toggle-action" aria-pressed={Boolean(value)} onClick={() => setValue(!value)}>
      {control.description ?? control.label}
    </button>
  );
}

/** Hook-free, called directly to verify it warns and returns null rather than throwing. */
export function UnsupportedKindFallback({ control }: { control: TrimControl }) {
  if (process.env.NODE_ENV !== "production") {
    console.error(`Trim: <Trim.Panel>'s default renderer has no widget for control kind "${control.kind}" (control "${control.id}"). Provide a custom renderer for it, or leave it out of your own panel.`);
  }
  return null;
}
