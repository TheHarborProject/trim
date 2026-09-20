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
    return document.documentElement.getAttribute(stateAttr) || serverSnapshotString;
  }
  function subscribe(notify: () => void) {
    const observer = new MutationObserver(notify);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [stateAttr] });
    return () => observer.disconnect();
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

  function parseState(value: string): TrimState<Schema> & { ready: boolean } {
    return { ...JSON.parse(value), ready: value !== serverSnapshotString } as TrimState<Schema> & { ready: boolean };
  }

  return { serverSnapshotString, snapshotString, parseState, subscribe, apply, restore, reset };
}
