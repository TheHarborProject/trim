"use client";

// @theharborproject/trim/react — Headless panel API.
//
// Four hooks, nothing else: reading the registry, resolving one integration
// or one control by id, and subscribing to one control's live value through
// its binding. This is the whole surface a fully custom panel needs —
// ./panel.tsx's <Trim.Panel> is built entirely on top of these, with no
// privileged access of its own.
//
// The resolution and snapshot/subscribe logic these hooks are thin
// useSyncExternalStore/useMemo/useCallback wrappers around
// (findIntegration, findControl, controlSnapshot, subscribeToControl) lives
// in ../advanced/resolution.ts — plain, exported, hook-free functions that
// operate on plain data (an array of TrimCore, or a TrimBinding) and can be
// unit-tested directly, without mounting a component. Only the wiring below
// needs an actual React render.

import { useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { TrimRegistryContext, defaultTrimRegistry } from "./registry-context";
import type { TrimRegistry } from "../core/registry";
import type { TrimCore, TrimControl } from "../core/integration";
import type { TrimBinding } from "../core/bindings";
import { findIntegration, findControl, controlSnapshot, subscribeToControl } from "../advanced/resolution";

function useRegistry(explicit?: TrimRegistry): TrimRegistry {
  const contextRegistry = useContext(TrimRegistryContext);
  return explicit ?? contextRegistry ?? defaultTrimRegistry;
}

/** All registered integrations, in stable {@link TrimRegistry} order. Re-renders only when the registry actually notifies (see registry.ts's notify-only-on-semantic-change). */
export function useTrimRegistry(registry?: TrimRegistry): readonly TrimCore[] {
  const target = useRegistry(registry);
  return useSyncExternalStore(target.subscribe, target.list, target.list);
}

/** One integration by id, or undefined if none is registered under it. */
export function useTrimIntegration(id: string, registry?: TrimRegistry): TrimCore | undefined {
  const integrations = useTrimRegistry(registry);
  return useMemo(() => findIntegration(integrations, id), [integrations, id]);
}

/** One control by its "<integrationId>.<controlId>" ref, or undefined if either half is missing. */
export function useTrimControl<V = unknown>(ref: string, registry?: TrimRegistry): TrimControl<V> | undefined {
  const integrations = useTrimRegistry(registry);
  return useMemo(() => findControl<V>(integrations, ref), [integrations, ref]);
}

export type TrimControlState<V = unknown> = {
  control: TrimControl<V> | undefined;
  value: V | undefined;
  setValue: (value: V) => void;
};

/** The control's definition, its live value (subscribed through binding.subscribe()), and a setter. Safe to call for a ref that doesn't (yet) resolve to anything — `value` is undefined and `setValue` is a dev-warning no-op. */
export function useTrimControlState<V = unknown>(ref: string, registry?: TrimRegistry): TrimControlState<V> {
  const control = useTrimControl<V>(ref, registry);
  // TrimControl's binding member type is only truly generic for "custom"
  // controls — for the built-in kinds it's fixed (ToggleControl always
  // binds boolean, SegmentedControl<string> always binds string). The
  // caller's own `V` type parameter is the source of truth here.
  const binding = control?.binding as TrimBinding<V> | undefined;

  // Stable across renders as long as `binding` itself is — true for
  // controller() and any binding built the same way (see bindings.ts's
  // WeakMap-cache pattern).
  const subscribe = useCallback((listener: () => void) => subscribeToControl(binding, listener), [binding]);
  const getSnapshot = useCallback(() => controlSnapshot(binding), [binding]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setValue = useCallback(
    (next: V) => {
      if (!binding) {
        if (process.env.NODE_ENV !== "production") console.error(`Trim: useTrimControlState("${ref}") — no control to write to.`);
        return;
      }
      binding.set(next);
    },
    [binding, ref],
  );

  return { control, value, setValue };
}
