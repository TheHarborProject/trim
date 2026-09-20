"use client";

// Installed by `trim add @shadcn/controls/segmented`. Host-owned from this
// point on. Uses your project's own shadcn ToggleGroup/ToggleGroupItem
// (see components.json's "ui" alias) as a single-select group — the same
// value/setValue/control.options contract
// @theharborproject/trim/react/controls/segmented's own default renderer
// consumes, never a new selected-state model.
import type { ReactNode } from "react";
import { ToggleGroup, ToggleGroupItem } from "__TRIM_SHADCN_UI_IMPORT__/toggle-group";
import type { TrimControlRendererProps } from "@theharborproject/trim/react";

export function ShadcnSegmentedControl({ control, value, setValue }: TrimControlRendererProps<string>) {
  if (control.kind !== "segmented") return null;
  return (
    <fieldset>
      <legend>{control.label}</legend>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={next => {
          // Radix's single-select ToggleGroup reports an empty string when
          // the currently-active item is clicked again (deselecting it).
          // Trim's segmented control always has a defined value, so a
          // deselect is deliberately ignored here — never forwarded as
          // setValue(""), which would not be one of control.options'
          // literal values.
          if (next) setValue(next);
        }}
      >
        {control.options.map(option => (
          <ToggleGroupItem key={String(option.value)} value={option.value}>
            {option.label as ReactNode}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </fieldset>
  );
}
