// Regression tests for src/core/controller-engine.ts's 0.1.3 performance
// patch: one shared MutationObserver per engine (fanning out to plain
// listeners) instead of one per subscribe() call, and a single-entry
// parseState() cache keyed on the snapshot string. Package-only: compiles
// nothing outside packages/trim/src.
//
// These are structural/count assertions (observer instances constructed,
// JSON.parse calls made), not wall-clock timing — the same shape as
// benchmarks/benchmark.mjs's instrumentation, kept deterministic here so
// they run safely under `pnpm test` / CI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(root, '.trim-engine-test-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/types.ts', 'src/core/settings.ts', 'src/core/controller-engine.ts',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const { createControllerEngine } = require(path.join(dir, 'core', 'controller-engine.js'));

  // --- instrumented doubles: count MutationObserver construct/observe/disconnect and JSON.parse ---
  function mockDocumentElement() {
    const attrs = {};
    return { getAttribute: k => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, attrs };
  }
  const counts = { constructed: 0, observeCalls: 0, disconnectCalls: 0 };
  class CountingMutationObserver {
    constructor(cb) { counts.constructed++; this.cb = cb; this._active = false; }
    observe(_target, options) { counts.observeCalls++; this.filter = options.attributeFilter || []; this._active = true; }
    disconnect() { counts.disconnectCalls++; this._active = false; }
    // Test-only trigger — real MutationObserver batches via microtask; this
    // fires the callback synchronously so assertions can be immediate.
    fire() { if (this._active) this.cb(); }
  }
  let liveObservers;
  class TrackingMutationObserver extends CountingMutationObserver {
    observe(target, options) { super.observe(target, options); liveObservers.add(this); }
    disconnect() { super.disconnect(); liveObservers.delete(this); }
  }

  const schema = { theme: ['light', 'dark'] };
  const defaults = { theme: 'light' };

  function freshEngine() {
    counts.constructed = 0; counts.observeCalls = 0; counts.disconnectCalls = 0;
    liveObservers = new Set();
    globalThis.MutationObserver = TrackingMutationObserver;
    const docEl = mockDocumentElement();
    globalThis.document = { documentElement: docEl };
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    const store = {};
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
    const engine = createControllerEngine(schema, defaults, 'trim-engine-test-key');
    return { engine, docEl, fireAll: () => { for (const o of [...liveObservers]) o.fire(); } };
  }

  // --- 1. one shared MutationObserver for many subscribers, not one each ---
  {
    const { engine, fireAll } = freshEngine();
    const seen = [[], [], [], [], []];
    const unsubs = seen.map((bucket, i) => engine.subscribe(() => bucket.push(i)));

    assert.equal(counts.constructed, 1, 'one MutationObserver total for 5 subscribers, not 5');
    assert.equal(counts.observeCalls, 1, 'observe() called once, on the first subscribe()');

    engine.apply({ theme: 'dark' }, false);
    fireAll();
    for (let i = 0; i < seen.length; i++) {
      assert.deepEqual(seen[i], [i], `subscriber ${i} is still notified — fan-out preserved through the shared observer`);
    }
    assert.equal(counts.constructed, 1, 'still exactly one observer after a real state change');

    for (const u of unsubs) u();
  }

  // --- 2. disconnect only when the LAST subscriber leaves; resubscribe after full drain creates a fresh observer ---
  {
    const { engine } = freshEngine();
    const stopA = engine.subscribe(() => {});
    const stopB = engine.subscribe(() => {});
    assert.equal(counts.constructed, 1);

    stopA();
    assert.equal(counts.disconnectCalls, 0, 'disconnect() must not fire while another subscriber is still active');

    stopB();
    assert.equal(counts.disconnectCalls, 1, 'disconnect() fires once the last subscriber unsubscribes');

    engine.subscribe(() => {});
    assert.equal(counts.constructed, 2, 'a subscribe() after full drain starts a fresh observer (no permanently-dead engine)');
  }

  // --- 3. unsubscribing one listener does not affect delivery to the others ---
  {
    const { engine, fireAll } = freshEngine();
    let a = 0, b = 0;
    const stopA = engine.subscribe(() => a++);
    engine.subscribe(() => b++);

    engine.apply({ theme: 'dark' }, false);
    fireAll();
    assert.equal(a, 1);
    assert.equal(b, 1);

    stopA();
    engine.apply({ theme: 'light' }, false);
    fireAll();
    assert.equal(a, 1, 'unsubscribed listener receives no further notifications');
    assert.equal(b, 2, 'remaining listener keeps receiving notifications');
  }

  // --- 4. parseState() cache: same string -> one JSON.parse and the same object reference; a real change -> a fresh parse ---
  {
    const { engine } = freshEngine();
    engine.apply({ theme: 'dark' }, false);
    const value = engine.snapshotString();

    let parseCalls = 0;
    const realParse = JSON.parse;
    JSON.parse = (...args) => { parseCalls++; return realParse(...args); };
    try {
      const first = engine.parseState(value);
      const second = engine.parseState(value);
      const third = engine.parseState(value);
      assert.equal(parseCalls, 1, 'repeated parseState() calls for the identical snapshot string cost exactly one JSON.parse');
      assert.equal(second, first, 'the cached result is the same object reference, not just deep-equal');
      assert.equal(third, first);
      assert.deepEqual(first, { settings: { theme: 'dark' }, systemReduced: false, ready: true }, 'parsed shape is unchanged by caching');

      engine.apply({ theme: 'light' }, false);
      const nextValue = engine.snapshotString();
      assert.notEqual(nextValue, value, 'sanity: apply() actually produced a different snapshot string');
      const fourth = engine.parseState(nextValue);
      assert.equal(parseCalls, 2, 'a genuinely different snapshot string is parsed fresh, not served from the stale cache');
      assert.notEqual(fourth, first, 'a different input never returns the previous cached object');
      assert.equal(fourth.settings.theme, 'light');
    } finally {
      JSON.parse = realParse;
    }
  }

  // --- 5. parseState() for the server snapshot still reports ready:false, cache included ---
  {
    const { engine } = freshEngine();
    const first = engine.parseState(engine.serverSnapshotString);
    const second = engine.parseState(engine.serverSnapshotString);
    assert.equal(first.ready, false);
    assert.equal(second, first);
  }

  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.MutationObserver;

  console.log('PASS core/controller-engine (0.1.3 perf patch): one shared MutationObserver fans out to all subscribers, disconnect only after the last unsubscribe, resubscribe-after-drain starts fresh, parseState() cache hits on identical strings and misses on real changes, cached shape unchanged');
} finally { rmSync(dir, { recursive: true, force: true }); }
