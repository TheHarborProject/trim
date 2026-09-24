"use client";

// Internal sibling of ./sections.tsx. Not part of any public entry point —
// no package.json export subpath points at this file's path directly, only
// at ./sections.js, so this stays unreachable from outside no matter what
// it exports at module level (same boundary as ../manifest.ts's
// toIntegration or ../config.ts's resolveTrimGroups). Split out specifically
// so importing @theharborproject/trim/react/layouts/sections exposes only
// DefaultSectionsLayout, the one thing that subpath is meant to publish.

import type { ComponentType, ReactNode } from "react";
import { DefaultBooleanControl } from "../controls/boolean";
import { DefaultSegmentedControl } from "../controls/segmented";
import { DefaultToggleActionControl } from "../controls/toggle-action";
import { UnsupportedKindFallback } from "../controls/unsupported-fallback";
import type { TrimControl } from "../../core/integration";
import type { TrimControlRendererProps } from "../renderer-contract";
import type { TrimRendererMap, TrimUIAdapter } from "../config";

export type RendererContext = {
  adapter?: TrimUIAdapter;
  renderers?: TrimRendererMap;
};

/**
 * Given an already-resolved control + its live value/setValue, renders the
 * per-item `component` override when one was given, otherwise dispatches to
 * the default renderer for `control.kind`. Deliberately hook-free (calls no
 * hook itself, unlike ./sections.tsx's LayoutItem) so it can be exercised
 * directly — the actual "what does a resolved item look like" logic lives
 * here, not tangled into the hook-calling wrapper.
 */
export function renderResolvedControl(
  control: TrimControl,
  value: unknown,
  setValue: (value: unknown) => void,
  groupName: string,
  Component?: ComponentType<TrimControlRendererProps<any>>,
  context: RendererContext = {},
): ReactNode {
  if (Component) {
    return <Component control={control} value={value} setValue={setValue} />;
  }

  const Renderer = context.renderers?.[control.kind];
  if (Renderer) {
    return <Renderer control={control} value={value} setValue={setValue} />;
  }

  if (context.adapter !== undefined && context.adapter !== "vanilla") {
    if (process.env.NODE_ENV !== "production") {
      console.error(`Trim: no renderer is registered for control "${control.id}" (kind "${control.kind}") with adapter "${context.adapter}". Provide ui.renderers["${control.kind}"] or an explicit component override.`);
    }
    return null;
  }

  switch (control.kind) {
    case "toggle":
      return <DefaultBooleanControl control={control as TrimControl<boolean>} value={value as boolean | undefined} setValue={setValue as (v: boolean) => void} />;
    case "segmented":
      return <DefaultSegmentedControl groupName={groupName} control={control as TrimControl<string>} value={value as string | undefined} setValue={setValue as (v: string) => void} />;
    case "toggle-action":
      return <DefaultToggleActionControl control={control as TrimControl<boolean>} value={value as boolean | undefined} setValue={setValue as (v: boolean) => void} />;
    default:
      return <UnsupportedKindFallback control={control} />;
  }
}
