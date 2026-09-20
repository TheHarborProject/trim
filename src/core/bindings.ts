// Trim — bindings. Framework-agnostic: no React import.
//
// The minimal contract a control needs to read/write/observe whatever
// mechanism already holds its value — three methods, nothing more. Factories
// below produce bindings for existing mechanisms without imposing one on the
// host project.

export interface TrimBinding<V> {
  get(): V;
  set(value: V): void;
  subscribe(listener: (value: V) => void): () => void;
}

/** Wraps a plain getter/setter/(optional)subscriber — for state not covered by a dedicated factory. */
export function callback<V>(
  get: () => V,
  set: (value: V) => void,
  subscribe: (listener: (value: V) => void) => () => void = () => () => {},
): TrimBinding<V> {
  return { get, set, subscribe };
}

// --- controller(...) --------------------------------------------------
// Built on ./controller's createTrimController's plain (non-hook)
// getSnapshot/apply/subscribe surface, so it works outside React too (no
// component, no render) — not just inside a JSX tree. Duck-typed
// structurally on purpose: this file never imports ./controller or
// @theharborproject/trim/react, which would pull React into the core entry.

interface ControllerLike<Settings extends Record<string, unknown>> {
  getSnapshot(): { settings: Settings };
  apply(settings: Settings, persist?: boolean): void;
  subscribe(listener: () => void): () => void;
}

// One binding instance per (controller, key) pair: `controller(toolsController, "loader")`
// called again on a later render (or from a second integration) returns the
// exact same object, so JSX call sites never need to wrap it in useMemo to
// keep it referentially stable.
const controllerBindingCache = new WeakMap<ControllerLike<Record<string, unknown>>, Map<PropertyKey, TrimBinding<unknown>>>();

export function controller<Settings extends Record<string, unknown>, K extends keyof Settings>(
  ctrl: ControllerLike<Settings>,
  key: K,
): TrimBinding<Settings[K]> {
  let perKey = controllerBindingCache.get(ctrl as ControllerLike<Record<string, unknown>>);
  if (!perKey) {
    perKey = new Map();
    controllerBindingCache.set(ctrl as ControllerLike<Record<string, unknown>>, perKey);
  }
  const cached = perKey.get(key);
  if (cached) return cached as TrimBinding<Settings[K]>;

  const binding: TrimBinding<Settings[K]> = {
    get: () => ctrl.getSnapshot().settings[key],
    set: value => ctrl.apply({ ...ctrl.getSnapshot().settings, [key]: value }, true),
    subscribe: listener => ctrl.subscribe(() => listener(ctrl.getSnapshot().settings[key])),
  };
  perKey.set(key, binding as TrimBinding<unknown>);
  return binding;
}
