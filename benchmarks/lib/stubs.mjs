// Lightweight, instrumented DOM/MutationObserver/localStorage doubles —
// no jsdom, no heavy dependency. Same spirit as tests/*.mjs's
// mockDocumentElement(), extended with counters so benchmarks can report
// exact operation counts (MutationObserver constructions, observe(),
// disconnect(), listener firings, setAttribute calls, localStorage writes),
// per "Instrumentation" in the audit brief.
//
// Trim's actual MutationObserver usage (controller-engine.ts's subscribe())
// observes a single attribute (`data-{prefix}-state`) on document.documentElement
// and re-reads the whole attribute string on any mutation — it never inspects
// mutation records. This stub is a faithful, synchronous model of exactly that
// contract (synchronous instead of microtask-batched, which only matters for
// timing granularity, not for the counts or fan-out shape being measured).

export function createInstrumentedEnvironment() {
  const counts = {
    mutationObserverConstructed: 0,
    observeCalls: 0,
    disconnectCalls: 0,
    listenerFired: 0,
    setAttributeCalls: 0,
    localStorageWrites: 0,
  };

  const attrs = Object.create(null);
  // Observers currently `observe()`-ing and not yet `disconnect()`-ed, keyed
  // by the single attribute name Trim ever filters on.
  const liveObservers = new Set();

  const docEl = {
    getAttribute(key) {
      return key in attrs ? attrs[key] : null;
    },
    setAttribute(key, value) {
      counts.setAttributeCalls++;
      const next = String(value);
      const changed = attrs[key] !== next;
      attrs[key] = next;
      if (changed) {
        for (const observer of liveObservers) {
          if (observer.filter.includes(key)) {
            counts.listenerFired++;
            observer.callback();
          }
        }
      }
    },
  };

  class MutationObserver {
    constructor(callback) {
      counts.mutationObserverConstructed++;
      this.callback = callback;
      this.filter = [];
    }
    observe(_target, options) {
      counts.observeCalls++;
      this.filter = options?.attributeFilter ?? [];
      liveObservers.add(this);
    }
    disconnect() {
      counts.disconnectCalls++;
      liveObservers.delete(this);
    }
  }

  const store = Object.create(null);
  const localStorage = {
    getItem: key => (key in store ? store[key] : null),
    setItem(key, value) {
      counts.localStorageWrites++;
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
  };

  const window = { matchMedia: () => ({ matches: false }) };

  return { document: { documentElement: docEl }, window, localStorage, MutationObserver, counts, attrs, liveObservers };
}

const GLOBAL_KEYS = ["document", "window", "localStorage", "MutationObserver"];

/** Installs an environment's globals for the duration of `fn()`, then restores the prior
 * state exactly — deleting a key that didn't exist before, rather than setting it to
 * `undefined` (which trips Node's own experimental global-localStorage warning). */
export function withGlobals(env, fn) {
  const saved = {};
  const hadOwn = {};
  for (const key of GLOBAL_KEYS) {
    hadOwn[key] = Object.prototype.hasOwnProperty.call(globalThis, key);
    saved[key] = globalThis[key];
    globalThis[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of GLOBAL_KEYS) {
      if (hadOwn[key]) globalThis[key] = saved[key];
      else delete globalThis[key];
    }
  }
}

/** Counts JSON.parse/JSON.stringify calls made inside fn(), without changing their behavior. */
export function countJson(fn) {
  const counts = { parse: 0, stringify: 0 };
  const realParse = JSON.parse;
  const realStringify = JSON.stringify;
  JSON.parse = (...args) => {
    counts.parse++;
    return realParse(...args);
  };
  JSON.stringify = (...args) => {
    counts.stringify++;
    return realStringify(...args);
  };
  try {
    const result = fn();
    return { ...counts, result };
  } finally {
    JSON.parse = realParse;
    JSON.stringify = realStringify;
  }
}
