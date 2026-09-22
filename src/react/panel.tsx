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
// --surface, ...). ../themes/default.css (published as
// @theharborproject/trim/themes/default.css, with @theharborproject/trim/panel.css
// kept as a compatibility alias to the same file) is a separate, optional
// stylesheet a host may choose to import.
//
// sortByOrder/groupInOrder lives in ../advanced — see that module's header
// for why. The individual kind renderers (DefaultBooleanControl/
// DefaultSegmentedControl/DefaultToggleActionControl/UnsupportedKindFallback)
// live in ./controls — imported directly from their canonical location here,
// not through ../advanced/widgets.tsx's compatibility re-exports, which
// exist for external `@theharborproject/trim/advanced` consumers, not for
// this package's own internal wiring. This file only contains the pieces
// that actually call a hook (<Trim.Panel>, <Trim.Control>) or compose them
// (<Trim.Section>).

import { useId, useMemo, useState, type ReactNode } from "react";
import { useTrimControlState, useTrimRegistry } from "./hooks";
import { groupInOrder } from "../advanced/sorting";
import { DefaultBooleanControl } from "./controls/boolean";
import { DefaultSegmentedControl } from "./controls/segmented";
import { DefaultToggleActionControl } from "./controls/toggle-action";
import { UnsupportedKindFallback } from "./controls/unsupported-fallback";
import { DefaultSectionsLayout } from "./layouts/sections";
import { resolveTrimGroups, warnOnUniquenessViolations, type TrimConfig } from "./config";
import { resolveShell } from "./shell/resolve";
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
      return <DefaultBooleanControl control={control as TrimControl<boolean>} value={value as boolean | undefined} setValue={setValue as (v: boolean) => void} />;
    case "segmented":
      return <DefaultSegmentedControl groupName={`${instanceId}-${controlRef}`} control={control as TrimControl<string>} value={value as string | undefined} setValue={setValue as (v: string) => void} />;
    case "toggle-action":
      return <DefaultToggleActionControl control={control as TrimControl<boolean>} value={value as boolean | undefined} setValue={setValue as (v: boolean) => void} />;
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

export type PanelProps = { children?: ReactNode; config?: TrimConfig; registry?: TrimRegistry };

/**
 * The config-driven path: resolves `config.groups` once (memoized — the
 * whole point of this path is that trim.config.tsx already decided order
 * statically, so this must not re-sort or rediscover anything on every
 * render), dev-validates is_unique against the live registry, then hands
 * off to whichever layout the config names — DefaultSectionsLayout for
 * "sections", or the host's own component when `layout` is a function.
 *
 * The resolved layout's output is then wrapped by whichever shell
 * `config.ui` resolves to (see ./shell/resolve.ts) — `open` is owned here,
 * not by the shell itself, so it's this one `useState` that decides whether
 * a config-driven panel starts open or closed, same as any other controlled
 * component. `config.ui` omitted (or `{ adapter: "vanilla", shell: "inline" }`
 * explicitly) resolves to a passthrough with no wrapper element at all — see
 * ./shell/vanilla-inline.tsx — so this changes nothing for a config that
 * never sets `ui`.
 */
function ConfiguredPanel({ config, registry }: { config: TrimConfig; registry?: TrimRegistry }) {
  const integrations = useTrimRegistry(registry);
  const groups = useMemo(() => resolveTrimGroups(config.groups), [config.groups]);
  warnOnUniquenessViolations(groups, integrations); // self-gated — see ./config.ts
  const Layout = typeof config.layout === "function" ? config.layout : DefaultSectionsLayout;
  const Shell = useMemo(() => resolveShell(config.ui?.adapter, config.ui?.shell), [config.ui?.adapter, config.ui?.shell]);
  const [open, setOpen] = useState(false);
  return (
    <Shell open={open} onOpenChange={setOpen}>
      <Layout groups={groups} registry={registry} />
    </Shell>
  );
}

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
 * Precedence, most to least specific — `children` always wins, `config` is
 * the fallback when there are none, auto-discovery is the fallback when
 * there's neither:
 *
 * - `<Trim.Panel>{children}</Trim.Panel>`: a plain, unopinionated
 *   container — put <Trim.Section>/<Trim.Control> (or anything else) inside
 *   for full control over layout. Unchanged since 0.1.
 * - `<Trim.Panel config={trimConfig} />` (no children): renders through the
 *   config-driven layout path (ConfiguredPanel above).
 * - `<Trim.Panel />` (neither): discovers every registered integration
 *   automatically, grouped by meta.group (registration order, overridable
 *   per-integration with meta.order), each control rendered by its kind.
 *   Unchanged since 0.1.
 *
 * Both `config` and `children` together is very likely a mistake — nothing
 * about `children` winning is visible from the call site otherwise — so
 * `config` is not silently dropped: it's ignored (children still win, the
 * least surprising choice given `children` already overrode auto-discovery
 * before `config` existed) but a dev warning names exactly what happened.
 */
export function Panel({ children, config, registry }: PanelProps) {
  if (process.env.NODE_ENV !== "production" && children != null && config) {
    console.error("Trim: <Trim.Panel> received both `config` and `children` — `children` take precedence and `config` is ignored. Remove one.");
  }
  return (
    <div data-trim-panel>
      {children ?? (config ? <ConfiguredPanel config={config} registry={registry} /> : <AutoPanel registry={registry} />)}
    </div>
  );
}
