// Trim — the settings-controller mechanism shared by ./controller.ts's
// framework-agnostic createTrimController and @theharborproject/trim/react's
// createTrimController (which wraps this exact engine and adds
// useSettings()). Framework-agnostic: no React import, no "use client" — the
// only reason createTrimController's React version needs the directive is
// useSettings() itself, which lives entirely in the react/ entry point.
//
// Not exported from any public entry point: this file is an internal
// implementation detail both controller.ts files build on, so the exact
// document/storage mechanism and snapshot serialization never has to be
// duplicated or kept in sync between the two.

import { clearStoredSettings, normalizeSettings, readStoredSettings, writeStoredSettings } from "./settings";
import type { TrimOptionsSchema, TrimSettings, TrimState, MotionValue, MotionConfig, MotionResolver } from "../types";

export type TrimControllerOptions<Schema extends TrimOptionsSchema> = {
  motion?: MotionConfig<Schema>;
};

function systemPrefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const defaultResolveMotion: MotionResolver = (rawValue, systemReduced) =>
  (systemReduced && rawValue === "full" ? "reduced" : rawValue) as MotionValue;

export interface TrimControllerEngine<Schema extends TrimOptionsSchema> {
  /** Fixed at creation time — the SSR/pre-hydration fallback snapshot string. */
  serverSnapshotString: string;
  /** The live document/storage-backed snapshot string, or serverSnapshotString before any write has happened. Referentially stable (a plain string) across calls when nothing changed — required for useSyncExternalStore in the React wrapper. */
  snapshotString(): string;
  parseState(value: string): TrimState<Schema> & { ready: boolean };
  subscribe(listener: () => void): () => void;
  apply(settings: TrimSettings<Schema>, persist?: boolean): void;
  restore(): void;
  reset(): void;
}

/** Builds one Trim instance's document/storage bindings for a given schema. `attrPrefix` namespaces its data-* attributes (e.g. "oa" or "trim"); `options.motion` is opt-in — omit it entirely for a schema with no motion-floor concept. */
export function createControllerEngine<Schema extends TrimOptionsSchema>(
  schema: Schema,
  defaults: TrimSettings<Schema>,
  storageKey: string,
  attrPrefix = "trim",
  options?: TrimControllerOptions<Schema>,
): TrimControllerEngine<Schema> {
  const motion = options?.motion;
  const resolveMotion = motion?.resolve ?? defaultResolveMotion;
  const stateAttr = `data-${attrPrefix}-state`;
  // The extra `ready: false` key can never appear in a real write (writeDocument
  // never includes it), so this string can never collide with one — `ready`
  // reliably flips to true as soon as any real prepaint/hydration write lands,
  // even one that happens to equal `defaults` (e.g. first visit, no stored
  // preference, motion not reduced). Dropping this key would make `ready`
  // incorrectly stay false in exactly that — the most common — case.
  const serverSnapshotString = JSON.stringify(
    motion
      ? { settings: defaults, motion: defaults[motion.key], systemReduced: false, ready: false }
      : { settings: defaults, systemReduced: false, ready: false },
  );

  function snapshotString() {
    if (typeof document === "undefined") return serverSnapshotString;
    return document.documentElement.getAttribute(stateAttr) || serverSnapshotString;
  }

  // One MutationObserver per engine instance, shared by every subscriber —
  // not one per subscribe() call. A panel with many controls bound to this
  // same controller previously meant one redundant observer per mounted
  // control, all watching the identical attribute and all firing on every
  // change; they now share the single observer below and are fanned out to
  // via a plain listener Set (the same notify-a-Set-of-listeners shape
  // ../core/registry.ts already uses), with disconnect() only once the last
  // subscriber leaves. External behavior is unchanged: subscribe() still
  // returns an unsubscribe function, and notification still happens
  // asynchronously via the browser's real MutationObserver batching — only
  // the number of observer instances backing it changes.
  let sharedObserver: MutationObserver | null = null;
  const listeners = new Set<() => void>();

  function notifyListeners() {
    for (const listener of listeners) listener();
  }

  function subscribe(notify: () => void) {
    listeners.add(notify);
    if (!sharedObserver) {
      sharedObserver = new MutationObserver(notifyListeners);
      sharedObserver.observe(document.documentElement, { attributes: true, attributeFilter: [stateAttr] });
    }
    return () => {
      listeners.delete(notify);
      if (listeners.size === 0 && sharedObserver) {
        sharedObserver.disconnect();
        sharedObserver = null;
      }
    };
  }

  function writeDocument(settings: TrimSettings<Schema>, motionValue: MotionValue | undefined, systemReduced: boolean) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(settings)) root.setAttribute(`data-${attrPrefix}-${key.toLowerCase()}`, value as string);
    const state: Record<string, unknown> = { settings, systemReduced };
    if (motionValue !== undefined) {
      root.setAttribute(`data-${attrPrefix}-motion`, motionValue);
      state.motion = motionValue;
    }
    root.setAttribute(stateAttr, JSON.stringify(state));
  }

  /** A stored/proposed "full" is only a fallback base — an explicit, valid raw value at `motion.key` always wins (see resolveMotion for the actual reduced-motion floor). No-op when no motion config was given. */
  function seededDefaults(systemReduced: boolean): TrimSettings<Schema> {
    if (!motion) return defaults;
    return { ...defaults, [motion.key]: systemReduced ? "reduced" : "full" } as TrimSettings<Schema>;
  }

  function apply(settings: TrimSettings<Schema>, persist = true) {
    const systemReduced = systemPrefersReducedMotion();
    // Invalid/missing keys in `settings` fall back to `defaults`, not to `settings`
    // itself — a value already partly-invalid must not be able to keep itself.
    const valid = normalizeSettings(schema, seededDefaults(systemReduced), settings);
    const motionValue = motion ? resolveMotion(valid[motion.key] as string, systemReduced) : undefined;
    writeDocument(valid, motionValue, systemReduced);
    if (persist) writeStoredSettings(storageKey, valid);
  }

  function restore() {
    const systemReduced = systemPrefersReducedMotion();
    apply(readStoredSettings(schema, seededDefaults(systemReduced), storageKey), false);
  }

  function reset() {
    clearStoredSettings(storageKey);
    apply(seededDefaults(systemPrefersReducedMotion()), false);
  }

  // Single-entry cache keyed on the snapshot string's own value: only one
  // snapshot is ever "current" at a time, so the last-parsed string/result
  // pair is all repeat callers (getSnapshot(), every controller() binding
  // reading the same key, every fan-out listener re-reading after a change)
  // need to skip a redundant JSON.parse of the exact same string. The
  // returned object is shared across callers for the same value — callers
  // read it as plain data (property access only) and must not mutate it.
  let lastParsedValue: string | undefined;
  let lastParsedResult: (TrimState<Schema> & { ready: boolean }) | undefined;

  function parseState(value: string): TrimState<Schema> & { ready: boolean } {
    if (lastParsedValue === value && lastParsedResult) return lastParsedResult;
    lastParsedValue = value;
    lastParsedResult = { ...JSON.parse(value), ready: value !== serverSnapshotString } as TrimState<Schema> & { ready: boolean };
    return lastParsedResult;
  }

  return { serverSnapshotString, snapshotString, parseState, subscribe, apply, restore, reset };
}
