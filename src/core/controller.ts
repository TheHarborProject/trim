// Trim — framework-agnostic settings controller. No React import, usable
// outside any component tree, any renderer, even outside React entirely
// (Vite, Remix, a plain Node script). @theharborproject/trim/react's
// createTrimController wraps this exact engine (./controller-engine.ts) and
// adds a useSettings() hook on top — same document/storage mechanism, same
// behavior, nothing duplicated.

import { createControllerEngine, type TrimControllerOptions } from "./controller-engine";
import type { TrimOptionsSchema, TrimSettings, TrimState } from "../types";

export type { TrimControllerOptions } from "./controller-engine";

export type TrimController<Schema extends TrimOptionsSchema> = {
  /** Same shape a React hook consumer would get from useSettings(), callable anywhere (e.g. from a binding, or a non-React host). */
  getSnapshot: () => TrimState<Schema> & { ready: boolean };
  /** The same MutationObserver-backed subscription @theharborproject/trim/react's useSettings() uses internally, exposed directly. */
  subscribe: (listener: () => void) => () => void;
  apply: (settings: TrimSettings<Schema>, persist?: boolean) => void;
  restore: () => void;
  reset: () => void;
};

/** Trim's own opinionated settings engine: validation against a schema, a `data-{prefix}-*` attribute as the live state (so a prepaint `<script>` can apply it before first paint), and `localStorage` persistence. `attrPrefix` namespaces its data-* attributes (e.g. "oa" or "trim"); `options.motion` is opt-in — omit it entirely for a schema with no motion-floor concept. */
export function createTrimController<Schema extends TrimOptionsSchema>(
  schema: Schema,
  defaults: TrimSettings<Schema>,
  storageKey: string,
  attrPrefix = "trim",
  options?: TrimControllerOptions<Schema>,
): TrimController<Schema> {
  const engine = createControllerEngine(schema, defaults, storageKey, attrPrefix, options);
  return {
    getSnapshot: () => engine.parseState(engine.snapshotString()),
    subscribe: engine.subscribe,
    apply: engine.apply,
    restore: engine.restore,
    reset: engine.reset,
  };
}
