// Unit tests for the settings controller — src/core/controller.ts (fully
// framework-agnostic: getSnapshot/subscribe/apply/restore/reset) and
// src/react/controller.ts (the same engine plus useSettings()). Package-only:
// compiles nothing outside packages/trim/src, every schema here is a toy
// fixture. useSettings() itself needs an actual React render
// (useSyncExternalStore) to exercise, which this package's test setup
// (compile + require, no test renderer) doesn't provide — same limitation
// ONE:ACCESS's own scripts/test-oa-tools-browser.mjs exists to cover for the
// host's real usage. Everything useSettings() is a thin wrapper around
// (snapshotString/parseState/subscribe) is fully covered here through the
// engine's other methods, which both controllers expose directly.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
// Built inside the package tree so the compiled react/controller.js's
// require("react") resolves.
const dir = mkdtempSync(path.join(root, '.trim-controller-test-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/types.ts', 'src/core/settings.ts', 'src/core/controller-engine.ts', 'src/core/controller.ts', 'src/react/controller.ts',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const { createTrimController: createCoreController } = require(path.join(dir, 'core', 'controller.js'));
  const { createTrimController: createReactController } = require(path.join(dir, 'react', 'controller.js'));

  function mockDocumentElement() {
    const attrs = {};
    return { getAttribute: k => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, attrs };
  }

  const schema = { animations: ['full', 'reduced', 'none'], text: ['100', '150', '200'] };
  const defaults = { animations: 'full', text: '100' };

  // Runs the exact same behavioral assertions against BOTH the core (no
  // useSettings) and react (useSettings added) controllers — same engine
  // under both, so this proves neither public entry drifts from it.
  for (const [label, createTrimController] of [['core', createCoreController], ['react', createReactController]]) {
    let reduced = false;
    const store = {};
    const docEl = mockDocumentElement();
    globalThis.document = { documentElement: docEl };
    globalThis.window = { matchMedia: () => ({ matches: reduced }) };
    globalThis.localStorage = {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
      removeItem: k => { delete store[k]; },
    };

    const STORAGE_KEY = `test-controller-key-${label}`;
    const controller = createTrimController(schema, defaults, STORAGE_KEY, 'oa', { motion: { key: 'animations' } });
    const readState = () => JSON.parse(docEl.getAttribute('data-oa-state'));

    // --- snapshot d'état + attributs data-oa-* sur <html> ---
    reduced = false;
    controller.apply({ ...defaults, text: '150' }, false);
    assert.deepEqual(readState().settings, { animations: 'full', text: '150' }, `[${label}] apply() writes the validated settings`);
    assert.equal(readState().motion, 'full');
    assert.equal(readState().systemReduced, false);
    assert.equal(docEl.getAttribute('data-oa-text'), '150');
    assert.equal(docEl.getAttribute('data-oa-animations'), 'full');
    assert.equal(docEl.getAttribute('data-oa-motion'), 'full');

    // invalid value falls back to defaults, not to the rest of the passed object
    controller.apply({ ...defaults, text: '999' }, false);
    assert.equal(readState().settings.text, '100', `[${label}] invalid text falls back to the default, not to itself`);

    // --- prefers-reduced-motion (floor, not overwrite of the raw choice) ---
    reduced = true;
    controller.apply({ ...defaults, animations: 'full' }, false);
    assert.equal(readState().settings.animations, 'full', `[${label}] the raw user choice is preserved on data-oa-animations`);
    assert.equal(readState().motion, 'reduced', `[${label}] data-oa-motion is floored to reduced by the system preference`);

    // --- persistance (et son absence quand persist=false) ---
    delete store[STORAGE_KEY];
    controller.apply({ ...defaults, text: '150' }, false);
    assert.equal(STORAGE_KEY in store, false, `[${label}] persist=false must not write to storage`);
    controller.apply({ ...defaults, text: '150' }, true);
    assert.equal(store[STORAGE_KEY], JSON.stringify({ animations: 'full', text: '150' }), `[${label}] persist=true writes exactly the validated settings`);

    // --- restauration, y compris stockage vide sous prefers-reduced-motion ---
    delete store[STORAGE_KEY];
    reduced = true;
    controller.restore();
    assert.deepEqual(readState().settings, { animations: 'reduced', text: '100' }, `[${label}] restore() with empty storage falls back to reduced-aware defaults, not hardcoded "full"`);

    store[STORAGE_KEY] = JSON.stringify({ text: '200' });
    reduced = false;
    controller.restore();
    assert.deepEqual(readState().settings, { animations: 'full', text: '200' }, `[${label}] restore() with a stored partial value validates normally`);

    // --- comportement multi-onglets : restore() reflète ce qu'une autre instance a persisté ---
    const otherTabValue = { animations: 'none', text: '150' };
    controller.apply(otherTabValue, true); // simulates another tab's own apply(..., true)
    docEl.setAttribute('data-oa-state', JSON.stringify({ settings: defaults, motion: 'full', systemReduced: false })); // this tab still shows stale state
    controller.restore(); // simulates this tab's storage-event handler calling restore()
    assert.deepEqual(readState().settings, otherTabValue, `[${label}] restore() picks up what another tab persisted`);

    // --- reset ---
    store[STORAGE_KEY] = JSON.stringify({ text: '200' });
    reduced = true;
    controller.reset();
    assert.equal(STORAGE_KEY in store, false, `[${label}] reset() clears storage`);
    assert.deepEqual(readState().settings, { animations: 'reduced', text: '100' }, `[${label}] reset() restores reduced-aware defaults`);

    // --- SSR/hydratation : le sentinel "ready" ne doit jamais collisionner avec un vrai écrit ---
    const oracleServerSnapshot = JSON.stringify({ settings: defaults, motion: defaults.animations, systemReduced: false, ready: false });
    const freshDocEl = mockDocumentElement();
    globalThis.document = { documentElement: freshDocEl };
    reduced = false;
    controller.apply(defaults, false); // the exact-defaults, non-reduced case — the most common first visit
    const writtenAfterDefaultsApply = freshDocEl.getAttribute('data-oa-state');
    assert.notEqual(
      writtenAfterDefaultsApply, oracleServerSnapshot,
      `[${label}] a real write that happens to equal the defaults must still differ from the SSR fallback string, so getSnapshot()'s ready correctly becomes true`,
    );
    assert.equal(controller.getSnapshot().ready, true);
    globalThis.document = { documentElement: docEl };

    // --- plusieurs instances : deux controllers créés séparément ne partagent pas d'état ---
    const firstControllerTextBeforeSecond = controller.getSnapshot().settings.text;
    const secondController = createTrimController(schema, defaults, `${STORAGE_KEY}-second`, 'oa2');
    secondController.apply({ ...defaults, text: '200' }, false);
    assert.equal(controller.getSnapshot().settings.text, firstControllerTextBeforeSecond, `[${label}] a second, independently-created controller instance does not affect the first`);
    assert.equal(secondController.getSnapshot().settings.text, '200');

    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.localStorage;
  }

  // =========================================================================
  // A schema with NO motion key at all — createTrimController must work
  // fully without a 5th argument, and never mention "motion" anywhere, on
  // BOTH entry points.
  // =========================================================================
  for (const [label, createTrimController] of [['core', createCoreController], ['react', createReactController]]) {
    const noMotionSchema = { theme: ['light', 'dark'], density: ['comfortable', 'compact'] };
    const noMotionDefaults = { theme: 'light', density: 'comfortable' };
    const KEY = `test-no-motion-key-${label}`;
    const el = mockDocumentElement();
    globalThis.document = { documentElement: el };
    globalThis.window = { matchMedia: () => ({ matches: false }) };
    const store = {};
    globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };

    const noMotion = createTrimController(noMotionSchema, noMotionDefaults, KEY, 'nomotion'); // no options.motion at all
    const read = () => JSON.parse(el.getAttribute('data-nomotion-state'));

    noMotion.apply({ theme: 'dark', density: 'compact' });
    assert.deepEqual(read().settings, { theme: 'dark', density: 'compact' }, `[${label}] no-motion controller applies settings normally`);
    assert.equal('motion' in read(), false, `[${label}] no "motion" key appears in data-nomotion-state at all`);
    assert.equal(el.getAttribute('data-nomotion-motion'), null, `[${label}] no data-nomotion-motion attribute is ever written`);
    assert.equal(read().systemReduced, false, `[${label}] systemReduced is still reported — that part is not motion-config-gated`);

    assert.equal(store[KEY], JSON.stringify({ theme: 'dark', density: 'compact' }), `[${label}] persistence works with no motion key`);

    delete store[KEY];
    noMotion.restore();
    assert.deepEqual(read().settings, noMotionDefaults, `[${label}] restore() with empty storage falls back to plain defaults (no reduced-motion seeding to apply)`);

    noMotion.reset();
    assert.equal(KEY in store, false, `[${label}] reset() clears storage`);
    assert.deepEqual(read().settings, noMotionDefaults, `[${label}] reset() restores plain defaults`);

    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.localStorage;
  }

  console.log('PASS core/controller + react/controller: snapshot & data-oa-* attributes, invalid-value fallback, reduced-motion floor, persistence, restore (incl. empty+reduced and cross-tab), reset, SSR/hydration ready sentinel, independent multiple instances — with and without a motion key, on both entry points');
} finally { rmSync(dir, { recursive: true, force: true }); }
