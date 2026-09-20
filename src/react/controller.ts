"use client";

// @theharborproject/trim/react — createTrimController + useSettings(): the
// React-hook convenience layer over the framework-agnostic engine
// (../core/controller-engine.ts). Same engine, same document/storage
// mechanism, same options as ../core/controller.ts's createTrimController —
// this is what a host builds its own controller instance from when it wants
// the hook, not just getSnapshot()/subscribe().

import { useMemo, useSyncExternalStore } from "react";
import { createControllerEngine, type TrimControllerOptions } from "../core/controller-engine";
import type { TrimOptionsSchema, TrimSettings, TrimState } from "../types";

export type { TrimControllerOptions } from "../core/controller-engine";

export type TrimController<Schema extends TrimOptionsSchema> = {
  /** Subscribes to the live settings; `ready` is false until prepaint/restore has run on the client. React-only. */
  useSettings: () => TrimState<Schema> & { ready: boolean };
  /** Same shape as useSettings()'s return value, callable outside a React render (e.g. from a binding). */
  getSnapshot: () => TrimState<Schema> & { ready: boolean };
  /** Same MutationObserver-backed subscription useSettings() uses internally, exposed directly. */
  subscribe: (listener: () => void) => () => void;
  apply: (settings: TrimSettings<Schema>, persist?: boolean) => void;
  restore: () => void;
  reset: () => void;
};

/** Trim's own opinionated settings engine, with a useSettings() hook on top: validation against a schema, a `data-{prefix}-*` attribute as the live state (so a prepaint `<script>` can apply it before first paint), and `localStorage` persistence. `attrPrefix` namespaces its data-* attributes (e.g. "oa" or "trim"); `options.motion` is opt-in — omit it entirely for a schema with no motion-floor concept. */
export function createTrimController<Schema extends TrimOptionsSchema>(
  schema: Schema,
  defaults: TrimSettings<Schema>,
  storageKey: string,
  attrPrefix = "trim",
  options?: TrimControllerOptions<Schema>,
): TrimController<Schema> {
  const engine = createControllerEngine(schema, defaults, storageKey, attrPrefix, options);

  function useSettings() {
    const value = useSyncExternalStore(engine.subscribe, engine.snapshotString, () => engine.serverSnapshotString);
    return useMemo(() => engine.parseState(value), [value]);
  }

  return {
    useSettings,
    getSnapshot: () => engine.parseState(engine.snapshotString()),
    subscribe: engine.subscribe,
    apply: engine.apply,
    restore: engine.restore,
    reset: engine.reset,
  };
}
