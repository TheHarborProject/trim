"use client";

// @theharborproject/trim/react/controls/segmented — Trim's default renderer
// for a "segmented" (string enum) control. Hook-free, props-in/JSX-out — see
// ./boolean.tsx's header for the shared rationale.
//
// `groupName` sits outside TrimControlRendererProps deliberately: native
// <input type="radio"> groups by `name` alone, with no notion of "which
// rendered instance" it belongs to, so whoever composes this control (e.g.
// react/panel.tsx's <Trim.Panel>) must supply a per-mount-unique name to
// keep two rendered instances of the SAME control from merging into one
// native radio group. A renderer that only ever renders a control once can
// pass the control's own id.
//
// Moved from ../../advanced/widgets.tsx (formerly SegmentedWidget) — that
// file now re-exports this implementation under its original name, so
// existing `@theharborproject/trim/advanced` imports keep working
// unchanged.

import type { ReactNode } from "react";
import type { TrimControlRendererProps } from "../renderer-contract";

export type DefaultSegmentedControlProps = TrimControlRendererProps<string> & { groupName: string };

export function DefaultSegmentedControl({ groupName, control, value, setValue }: DefaultSegmentedControlProps) {
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
