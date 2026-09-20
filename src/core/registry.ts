// Trim — registry. Framework-agnostic: no React import.
//
// Holds integration descriptors ({id, meta, controls}) keyed by id, in
// stable insertion order, and notifies subscribers only when a semantically
// meaningful change is detected — a shallow comparison of meta and each
// control's own fields, deliberately not a generic deep-equal.

import type { TrimCore, TrimControl, SegmentedControl } from "./integration";

export type TrimRegistry = {
  register(integration: TrimCore): void;
  unregister(id: string): void;
  get(id: string): TrimCore | undefined;
  list(): readonly TrimCore[];
  subscribe(listener: () => void): () => void;
};

function shallowEqualOptions(a: SegmentedControl["options"], b: SegmentedControl["options"]): boolean {
  if (a.length !== b.length) return false;
  return a.every((option, index) => option.value === b[index]?.value && option.label === b[index]?.label);
}

function shallowEqualControl(a: TrimControl, b: TrimControl): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.kind !== b.kind || a.label !== b.label || a.description !== b.description || a.binding !== b.binding) return false;
  if (a.kind === "segmented" && b.kind === "segmented") return shallowEqualOptions(a.options, b.options);
  if (a.kind === "slider" && b.kind === "slider") return a.min === b.min && a.max === b.max && a.step === b.step;
  return true;
}

function shallowEqualControls(a: TrimCore["controls"], b: TrimCore["controls"]): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => Object.prototype.hasOwnProperty.call(b, key) && shallowEqualControl(a[key], b[key]));
}

/** Shallow only, deliberately: compares meta fields and each control's own fields, not a recursive deep-equal. */
function isSemanticallyEqual(a: TrimCore, b: TrimCore): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.meta.label === b.meta.label &&
    a.meta.description === b.meta.description &&
    a.meta.group === b.meta.group &&
    a.meta.order === b.meta.order &&
    shallowEqualControls(a.controls, b.controls)
  );
}

export function createTrimRegistry(): TrimRegistry {
  // A Map's iteration order is its insertion order, and re-setting an
  // existing key does NOT move it — so repeated register() calls for the
  // same id (updates, StrictMode's double-invoke) never reorder the list.
  const items = new Map<string, TrimCore>();
  const listeners = new Set<() => void>();
  // Cached so list() returns the SAME array reference across calls until
  // something actually notifies — required for useTrimRegistry()'s
  // useSyncExternalStore to behave (its snapshot must be referentially
  // stable when nothing changed, or React treats every read as a change).
  let cachedList: readonly TrimCore[] | null = null;

  function notify() {
    cachedList = null;
    for (const listener of listeners) listener();
  }

  return {
    register(integration) {
      const previous = items.get(integration.id);
      items.set(integration.id, integration);
      if (!previous || !isSemanticallyEqual(previous, integration)) notify();
    },
    unregister(id) {
      if (!items.has(id)) return;
      items.delete(id);
      notify();
    },
    get(id) {
      return items.get(id);
    },
    list() {
      if (!cachedList) cachedList = Array.from(items.values());
      return cachedList;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
