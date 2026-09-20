// Unit tests for src/core/bindings.ts. Package-only: compiles nothing
// outside packages/trim/src — the "real controller interop" section below
// uses a toy schema (not any host's), since that's all it actually needs.
//
// `subscribe()`'s wiring is tested against a fake ControllerLike (a plain
// object with its own listener array) rather than the real
// createTrimController: the real one's subscribe() is backed by a browser
// MutationObserver, which Node has no built-in and which wouldn't fire on a
// mocked, non-DOM `document.documentElement` anyway. get()/set() are
// exercised against the real controller instead, since neither touches
// MutationObserver, proving `controller(...)` genuinely interoperates with
// createTrimController outside of any React render.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(root, '.trim-bindings-test-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/types.ts', 'src/core/settings.ts', 'src/core/controller-engine.ts', 'src/core/controller.ts', 'src/core/bindings.ts',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const { controller, callback } = require(path.join(dir, 'core', 'bindings.js'));
  const { createTrimController } = require(path.join(dir, 'core', 'controller.js'));

  // --- callback(...) : contrat minimal ---
  let value = 'a';
  const listeners = new Set();
  const cb = callback(
    () => value,
    v => { value = v; for (const l of listeners) l(v); },
    l => { listeners.add(l); return () => listeners.delete(l); },
  );
  assert.equal(cb.get(), 'a');
  const seen = [];
  const unsub = cb.subscribe(v => seen.push(v));
  cb.set('b');
  assert.equal(cb.get(), 'b');
  assert.deepEqual(seen, ['b']);
  unsub();
  cb.set('c');
  assert.deepEqual(seen, ['b'], 'unsubscribe stops delivery');

  // callback() with no subscribe argument must not throw when subscribed to
  const silent = callback(() => 1, () => {});
  assert.doesNotThrow(() => silent.subscribe(() => {})());

  // --- controller(...) : stabilité référentielle (WeakMap) ---
  function fakeController(initial) {
    let settings = initial;
    const listeners = new Set();
    return {
      getSnapshot: () => ({ settings }),
      apply: (next) => { settings = next; for (const l of listeners) l(); },
      subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    };
  }
  const ctrlA = fakeController({ theme: 'light', density: 'comfortable' });
  const ctrlB = fakeController({ theme: 'dark', density: 'comfortable' });

  const bindingA1 = controller(ctrlA, 'theme');
  const bindingA2 = controller(ctrlA, 'theme');
  assert.equal(bindingA1, bindingA2, 'same (controller, key) pair returns the exact same binding object — no useMemo needed at call sites');

  const bindingADensity = controller(ctrlA, 'density');
  assert.notEqual(bindingA1, bindingADensity, 'different key on the same controller is a different binding');

  const bindingB1 = controller(ctrlB, 'theme');
  assert.notEqual(bindingA1, bindingB1, 'same key on a different controller instance is a different binding (WeakMap keyed by controller)');

  // --- controller(...) : get/set/subscribe delegate correctly ---
  assert.equal(bindingA1.get(), 'light');
  const notifications = [];
  const stop = bindingA1.subscribe(v => notifications.push(v));
  bindingA1.set('dark');
  assert.equal(bindingA1.get(), 'dark');
  assert.deepEqual(notifications, ['dark'], 'subscriber receives the new value for this key, not the whole settings object');
  assert.deepEqual(ctrlA.getSnapshot().settings, { theme: 'dark', density: 'comfortable' }, 'set() merges over the rest of the settings, does not replace the whole object');
  stop();
  bindingA1.set('light');
  assert.deepEqual(notifications, ['dark'], 'unsubscribe stops delivery for this binding too');

  // --- controller(...) : plusieurs instances/abonnés indépendants sur le même binding ---
  {
    const seenByFirst = [];
    const seenBySecond = [];
    const stopFirst = bindingADensity.subscribe(v => seenByFirst.push(v));
    const stopSecond = bindingADensity.subscribe(v => seenBySecond.push(v));
    bindingADensity.set('compact');
    assert.deepEqual(seenByFirst, ['compact'], 'first independent subscriber (e.g. a first rendered instance of the control) is notified');
    assert.deepEqual(seenBySecond, ['compact'], 'second independent subscriber (a second rendered instance of the SAME control) is notified too, from the same binding');
    stopFirst();
    bindingADensity.set('comfortable');
    assert.deepEqual(seenByFirst, ['compact'], 'the first subscriber stopped listening and does not see the next change');
    assert.deepEqual(seenBySecond, ['compact', 'comfortable'], 'the second subscriber, still active, keeps receiving updates — both instances stay backed by the one binding');
    stopSecond();
  }

  // --- controller(...) : interop réelle avec createTrimController, hors React ---
  const toySchema = { theme: ['light', 'dark'], density: ['comfortable', 'compact'] };
  const toyDefaults = { theme: 'light', density: 'comfortable' };
  const docAttrs = {};
  globalThis.document = { documentElement: { getAttribute: k => (k in docAttrs ? docAttrs[k] : null), setAttribute: (k, v) => { docAttrs[k] = String(v); } } };
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const store = {};
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };

  const realController = createTrimController(toySchema, toyDefaults, 'trim-bindings-test-key', 'trim');
  realController.apply(toyDefaults, false); // seed a known state, mirrors what prepaint/restore would do

  const themeBinding = controller(realController, 'theme');
  assert.equal(themeBinding.get(), realController.getSnapshot().settings.theme, 'get() matches the real controller snapshot');
  assert.equal(themeBinding.get(), 'light');

  themeBinding.set('dark');
  assert.equal(realController.getSnapshot().settings.theme, 'dark', 'set() actually calls through to the real controller.apply()');
  assert.equal(themeBinding.get(), 'dark');
  // every other field must be untouched by a single-field set()
  assert.deepEqual({ ...realController.getSnapshot().settings, theme: 'light' }, toyDefaults);

  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.localStorage;

  console.log('PASS core/bindings: callback() contract, controller() referential stability (per controller+key, across different controllers), get/set/subscribe delegation, multiple independent subscribers to one binding, real createTrimController interop outside React');
} finally { rmSync(dir, { recursive: true, force: true }); }
