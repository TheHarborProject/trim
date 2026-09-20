"use client";

// @theharborproject/trim/react — default renderer.
//
// Built entirely on the headless hooks (hooks.ts) — no privileged access to
// the registry or any binding. A host that wants a fully custom panel can
// ignore this file completely and write the same thing against
// useTrimRegistry()/useTrimControlState().
//
// Everything here is styled only through data-trim-* attributes — no CSS is
// imported by this file, and nothing here references a host token (--ink,
// --surface, ...). panel.css is a separate, optional stylesheet a host may
// choose to import.
//
// sortByOrder/groupInOrder and the individual kind widgets
// (ToggleWidget/SegmentedWidget/ToggleActionWidget/UnsupportedKindFallback)
// live in ../advanced — see that module's header for why. This file only
// contains the pieces that actually call a hook (<Trim.Panel>, <Trim.Control>)
// or compose them (<Trim.Section>).

import { useId, type ReactNode } from "react";
import { useTrimControlState, useTrimRegistry } from "./hooks";
import { groupInOrder } from "../advanced/sorting";
import { ToggleWidget, SegmentedWidget, ToggleActionWidget, UnsupportedKindFallback } from "../advanced/widgets";
import type { TrimControl } from "../core/integration";
import type { TrimRegistry } from "../core/registry";

function ControlWidget({ controlRef, registry }: { controlRef: string; registry?: TrimRegistry }) {
  const { control, value, setValue } = useTrimControlState(controlRef, registry);
  // A per-mount unique id: the SAME control (same binding, same controlRef)
  // can legitimately be rendered in more than one place at once — the
  // binding is the source of truth, so both instances stay in sync. Native
  // <input name> groups radios by name alone, with no notion of "which
  // React tree" they're in — sharing controlRef as the name would silently
  // merge two independent segmented controls into one native radio group
  // the moment a control is rendered twice. useId() keeps each rendered
  // instance's radios grouped with only its own siblings, regardless of how
  // many other places render the same control.
  const instanceId = useId();
  if (!control) {
    if (process.env.NODE_ENV !== "production") console.error(`Trim: <Trim.Control id="${controlRef}"> — no such control.`);
    return null;
  }
  switch (control.kind) {
    case "toggle":
      return <ToggleWidget control={control as TrimControl<boolean>} value={value as boolean | undefined} setValue={setValue as (v: boolean) => void} />;
    case "segmented":
      return <SegmentedWidget groupName={`${instanceId}-${controlRef}`} control={control as TrimControl<string>} value={value as string | undefined} setValue={setValue as (v: string) => void} />;
    case "toggle-action":
      return <ToggleActionWidget control={control as TrimControl<boolean>} value={value as boolean | undefined} setValue={setValue as (v: boolean) => void} />;
    default:
      return <UnsupportedKindFallback control={control} />;
  }
}

// --- public primitives -------------------------------------------------

export type ControlProps = { id: string };

/** Renders one control by its "<integrationId>.<controlId>" ref, resolved through the headless hooks. */
export function Control({ id }: ControlProps) {
  return <ControlWidget controlRef={id} />;
}

export type SectionProps = { title: string; collapsed?: boolean; children?: ReactNode };

/**
 * A titled, optionally-collapsed group. Uses native <details>/<summary> so
 * collapsing works without any JS or CSS. `children` is anything — nesting
 * another <Trim.Section> inside is not special-cased, and works for free.
 */
export function Section({ title, collapsed, children }: SectionProps) {
  return (
    <details data-trim-section open={!collapsed}>
      <summary data-trim-section-title>{title}</summary>
      <div data-trim-section-body>{children}</div>
    </details>
  );
}

export type PanelProps = { children?: ReactNode; registry?: TrimRegistry };

function AutoPanel({ registry }: { registry?: TrimRegistry }) {
  const integrations = useTrimRegistry(registry);
  const groups = groupInOrder(integrations);
  return (
    <>
      {groups.map(({ group, integrations: items }) => (
        <section key={group ?? "\u0000ungrouped"} data-trim-section>
          {group && <h3 data-trim-section-title>{group}</h3>}
          <div data-trim-section-body>
            {items.map(integration =>
              Object.keys(integration.controls).map(controlId => (
                <ControlWidget key={`${integration.id}.${controlId}`} controlRef={`${integration.id}.${controlId}`} registry={registry} />
              )),
            )}
          </div>
        </section>
      ))}
    </>
  );
}

/**
 * With no children: discovers every registered integration automatically,
 * grouped by meta.group (registration order, overridable per-integration
 * with meta.order), each control rendered by its kind.
 *
 * With children: a plain, unopinionated container — put <Trim.Section>/
 * <Trim.Control> (or anything else) inside for full control over layout.
 */
export function Panel({ children, registry }: PanelProps) {
  return <div data-trim-panel>{children ?? <AutoPanel registry={registry} />}</div>;
}
