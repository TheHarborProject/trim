"use client";

// @theharborproject/trim/react — JSX declarations.
//
// <Trim.Toggle>, <Trim.Segmented>, <Trim.Option> are passive descriptors: they
// are never mounted by React (never appear in <Trim.Integration>'s own
// render output), so they have no hooks, no effects, and never write to the
// registry themselves. <Trim.Integration> reads its `children` prop as plain
// data — via a walker deliberately limited to arrays, Fragments, Trim control
// elements, and null/false — builds one complete descriptor, and performs
// exactly one register()/unregister() cycle for the whole integration.
//
// This file is the only place in the package that needs to know how to read
// a JSX tree — @theharborproject/trim (the core) never sees a ReactElement.
// buildIntegrationDescriptor and its parser helpers stay in /react rather
// than /advanced or the core: they fundamentally operate on ReactElement/
// Children/Fragment, not on plain data, so they're React-specific in the
// strong sense even though none of them calls a hook — unlike
// ../advanced/resolution.ts's findIntegration/findControl, which operate on
// plain TrimCore[] arrays and would work identically behind any renderer.
// They also stay internal (not part of any public entry, exported from this
// file only for the package's own tests) per the same boundary the old
// lib/trim/index.ts already drew.

import { Children, Fragment, isValidElement, useContext, useEffect, type ReactElement, type ReactNode } from "react";
import type { TrimRegistry } from "../core/registry";
import { TrimRegistryContext, defaultTrimRegistry } from "./registry-context";
import type { TrimControl, TrimControlKind, TrimCore, TrimIntegrationMeta, SegmentedControl, SegmentedOption, ToggleActionControl, ToggleControl } from "../core/integration";
import type { TrimBinding } from "../core/bindings";

const TRIM_CONTROL = Symbol.for("trim.control");
// "option" is a valid marker value (identifies <Trim.Option>) but never a
// standalone TrimControl — it's only ever consumed while building a
// SegmentedControl's `options`, never registered on its own.
type TrimMarkerKind = TrimControlKind | "option";
type Marked<T> = T & { [TRIM_CONTROL]: TrimMarkerKind };

function warnDev(message: string) {
  if (process.env.NODE_ENV !== "production") console.error(`Trim: ${message}`);
}

function describeNode(node: unknown): string {
  if (isValidElement(node)) {
    const type = node.type as unknown;
    if (typeof type === "string") return `<${type}>`;
    const named = type as { displayName?: string; name?: string };
    return `<${named.displayName ?? named.name ?? "Component"}>`;
  }
  return typeof node === "object" ? "object" : typeof node;
}

function isFragmentElement(node: unknown): node is ReactElement<{ children?: ReactNode }> {
  return isValidElement(node) && node.type === Fragment;
}

/**
 * Deliberately narrow — not a generic JSX tree walker. It only ever descends
 * into: arrays (React.Children already flattens these), <>...</> Fragments
 * (React.Children does NOT look inside these on its own, so this is the one
 * case handled explicitly), elements whose type carries the TRIM_CONTROL
 * marker matching `accept`, and null/false/undefined/true (conditional
 * absence). Anything else is reported via warnDev and skipped.
 */
function walkDeclarative(
  children: ReactNode,
  accept: (kind: TrimMarkerKind) => boolean,
  onMatch: (element: ReactElement) => void,
  context: string,
): void {
  Children.forEach(children, child => {
    if (child == null || typeof child === "boolean") return;
    if (isFragmentElement(child)) {
      walkDeclarative(child.props.children, accept, onMatch, context);
      return;
    }
    if (isValidElement(child) && typeof child.type === "function") {
      const kind = (child.type as unknown as Marked<unknown>)[TRIM_CONTROL];
      if (kind && accept(kind)) {
        onMatch(child);
        return;
      }
    }
    warnDev(`unsupported child inside ${context} — expected an Trim control, an array, a Fragment, or null/false. Got: ${describeNode(child)}.`);
  });
}

// --- descriptor builders -------------------------------------------------

function buildToggleDescriptor(element: ReactElement<ToggleProps>): ToggleControl {
  const { id = "value", label, description, bind } = element.props;
  return { id, kind: "toggle", label, description, binding: bind };
}

function buildToggleActionDescriptor(element: ReactElement<ToggleActionProps>): ToggleActionControl {
  const { id = "value", label, description, bind } = element.props;
  return { id, kind: "toggle-action", label, description, binding: bind };
}

function buildSegmentedDescriptor(element: ReactElement<SegmentedProps<string>>): SegmentedControl<string> {
  const { id = "value", label, description, bind, children } = element.props;
  const options: SegmentedOption<string>[] = [];
  walkDeclarative(
    children,
    kind => kind === "option",
    optionElement => {
      const props = optionElement.props as OptionProps<string>;
      options.push({ value: props.value, label: props.children });
    },
    `<Trim.Segmented label="${label}">`,
  );
  return { id, kind: "segmented", label, description, binding: bind, options };
}

function buildControlDescriptor(element: ReactElement): TrimControl {
  const kind = (element.type as unknown as Marked<unknown>)[TRIM_CONTROL];
  switch (kind) {
    case "toggle": return buildToggleDescriptor(element as ReactElement<ToggleProps>);
    case "segmented": return buildSegmentedDescriptor(element as ReactElement<SegmentedProps<string>>);
    case "toggle-action": return buildToggleActionDescriptor(element as ReactElement<ToggleActionProps>);
    default: throw new Error(`Trim: unhandled control kind "${kind}".`);
  }
}

/** Exported for testing without a renderer: pass a tree built with React.createElement. Not part of any public entry point. */
export function buildIntegrationDescriptor(id: string, meta: TrimIntegrationMeta, children: ReactNode): TrimCore {
  const controls: Record<string, TrimControl> = {};
  walkDeclarative(
    children,
    kind => kind === "toggle" || kind === "segmented" || kind === "toggle-action",
    controlElement => {
      const control = buildControlDescriptor(controlElement);
      if (Object.prototype.hasOwnProperty.call(controls, control.id)) {
        warnDev(`duplicate control id "${control.id}" inside <Trim.Integration id="${id}">.`);
      }
      controls[control.id] = control;
    },
    `<Trim.Integration id="${id}">`,
  );
  return { id, meta, controls };
}

// --- declarative primitives — never mounted, so no DOM/effects/registry access ---

export type ToggleProps = {
  id?: string;
  label: string;
  description?: string;
  bind: TrimBinding<boolean>;
};

function Toggle(props: ToggleProps): null {
  warnDev(`<Trim.Toggle label="${props.label}"> was rendered directly — it must only be used as a declarative child of <Trim.Integration>.`);
  return null;
}
(Toggle as Marked<typeof Toggle>)[TRIM_CONTROL] = "toggle";

export type SegmentedProps<V extends string> = {
  id?: string;
  label: string;
  description?: string;
  bind: TrimBinding<V>;
  children?: ReactNode;
};

function Segmented<V extends string>(props: SegmentedProps<V>): null {
  warnDev(`<Trim.Segmented label="${props.label}"> was rendered directly — it must only be used as a declarative child of <Trim.Integration>.`);
  return null;
}
(Segmented as Marked<typeof Segmented>)[TRIM_CONTROL] = "segmented";

export type ToggleActionProps = {
  id?: string;
  label: string;
  description?: string;
  bind: TrimBinding<boolean>;
};

function ToggleAction(props: ToggleActionProps): null {
  warnDev(`<Trim.ToggleAction label="${props.label}"> was rendered directly — it must only be used as a declarative child of <Trim.Integration>.`);
  return null;
}
(ToggleAction as Marked<typeof ToggleAction>)[TRIM_CONTROL] = "toggle-action";

export type OptionProps<V extends string> = {
  value: V;
  children?: ReactNode;
};

function Option<V extends string>(props: OptionProps<V>): null {
  warnDev(`<Trim.Option value="${props.value}"> was rendered directly — it must only be used as a declarative child of <Trim.Segmented>.`);
  return null;
}
(Option as Marked<typeof Option>)[TRIM_CONTROL] = "option";

// --- registry wiring -------------------------------------------------------
// defaultTrimRegistry/TrimRegistryContext live in ./registry-context.ts,
// shared with ./hooks.ts, so the headless hooks don't need to import this
// (heavier, JSX-parsing) file to reach it.

export type RegistryProps = { registry?: TrimRegistry; children?: ReactNode };

/** Provides a registry to nested <Trim.Integration>s. Renders no DOM of its own. */
function Registry({ registry = defaultTrimRegistry, children }: RegistryProps) {
  return <TrimRegistryContext.Provider value={registry}>{children}</TrimRegistryContext.Provider>;
}

export type IntegrationProps = {
  id: string;
  group?: string;
  label?: string;
  description?: string;
  order?: number;
  children?: ReactNode;
};

/**
 * Parses its children into one descriptor and registers it in a single
 * register() call; the only cleanup is a single unregister() on unmount.
 * No context is exposed to children — they are never mounted, so they have
 * nothing to subscribe to.
 */
function Integration({ id, group, label, description, order, children }: IntegrationProps): null {
  const registry = useContext(TrimRegistryContext) ?? defaultTrimRegistry;

  useEffect(() => {
    const meta: TrimIntegrationMeta = { label: label ?? id, description, group, order };
    registry.register(buildIntegrationDescriptor(id, meta, children));
    // No cleanup here: this effect only ever *updates* the same id, and
    // register() replacing an existing id is an idempotent, order-preserving
    // operation — nothing to undo between one valid descriptor and the next.
  }, [registry, id, label, description, group, order, children]);

  useEffect(() => {
    // Cleanup-only: the one point where this integration actually leaves the registry.
    return () => registry.unregister(id);
  }, [registry, id]);

  return null;
}

// Named exports, not just re-exported as part of a namespace object here:
// see ./index.ts, which is the one place the full `Trim` object (including
// Panel/Section/Control) is assembled.
export { Registry, Integration, Toggle, Segmented, Option, ToggleAction };
