// Unit tests for src/advanced/resolution.ts — pure control/integration ref
// resolution, no hooks, no renderer. Package-only: uses toy fixtures, never
// a real host's integrations (unlike the old scripts/test-trim-hooks.mjs,
// which read this project's real trim-integrations.tsx and so was a
// ONE:ACCESS integration test in practice despite its name — see
// EXTRACTION.md). @theharborproject/trim/react's hooks.ts is a thin
// useSyncExternalStore/useMemo wrapper around exactly these functions.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(tmpdir(), 'trim-resolution-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/core/integration.ts', 'src/core/bindings.ts', 'src/advanced/resolution.ts',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const { findIntegration, findControl, resolveControlRef, trimControlRef, controlSnapshot, subscribeToControl } = require(path.join(dir, 'advanced', 'resolution.js'));

  const noopBind = { get: () => false, set: () => {}, subscribe: () => () => {} };
  const loader = { id: 'loader', meta: { label: 'Loader' }, controls: { value: { id: 'value', kind: 'toggle', label: 'Loader', binding: noopBind } } };
  const scroll = {
    id: 'narrative-scroll', meta: { label: 'Scroll' },
    controls: { value: { id: 'value', kind: 'segmented', label: 'Scroll', binding: noopBind, options: [{ value: 'full', label: 'Complet' }] } },
  };
  const integrations = [loader, scroll];

  // --- refs : resolveControlRef / trimControlRef ---
  assert.deepEqual(resolveControlRef('loader.value'), { integrationId: 'loader', controlId: 'value' });
  assert.deepEqual(resolveControlRef('narrative-scroll.value'), { integrationId: 'narrative-scroll', controlId: 'value' }, 'the integrationId itself may contain no "." — only the first "." is the separator');
  assert.throws(() => resolveControlRef('no-separator'), /invalid control id/, 'a ref with no "." throws with a clear message');
  assert.equal(trimControlRef('loader', 'value'), 'loader.value', 'the exact inverse of resolveControlRef');

  // --- findIntegration ---
  assert.equal(findIntegration(integrations, 'loader'), loader);
  assert.equal(findIntegration(integrations, 'does-not-exist'), undefined, 'a missing integration id resolves to undefined, not a throw');

  // --- findControl ---
  assert.equal(findControl(integrations, 'loader.value'), loader.controls.value);
  assert.equal(findControl(integrations, 'narrative-scroll.value'), scroll.controls.value);
  assert.equal(findControl(integrations, 'does-not-exist.value'), undefined, 'missing integration → undefined control, not a throw');
  assert.equal(findControl(integrations, 'loader.does-not-exist'), undefined, 'existing integration, missing control id → undefined');

  // --- controlSnapshot / subscribeToControl : pure wrappers over a binding ---
  let value = false;
  const listeners = new Set();
  const binding = {
    get: () => value,
    set: v => { value = v; for (const l of listeners) l(v); },
    subscribe: l => { listeners.add(l); return () => listeners.delete(l); },
  };
  assert.equal(controlSnapshot(binding), false);
  binding.set(true);
  assert.equal(controlSnapshot(binding), true, 'controlSnapshot reads the live value, not a cached one');
  assert.equal(controlSnapshot(undefined), undefined, 'no binding → undefined snapshot, not a throw');

  const seen = [];
  const unsubscribe = subscribeToControl(binding, () => seen.push(controlSnapshot(binding)));
  binding.set(false);
  assert.deepEqual(seen, [false]);
  unsubscribe();
  binding.set(true);
  assert.deepEqual(seen, [false], 'unsubscribe actually stops delivery');

  // --- plusieurs instances : deux abonnements indépendants sur le même binding via subscribeToControl ---
  const seenA = [];
  const seenB = [];
  const stopA = subscribeToControl(binding, () => seenA.push(1));
  const stopB = subscribeToControl(binding, () => seenB.push(1));
  binding.set(false);
  assert.deepEqual(seenA, [1]);
  assert.deepEqual(seenB, [1], 'two independent subscribeToControl() calls on the same binding are both notified — e.g. two rendered instances of the same control');
  stopA(); stopB();

  assert.doesNotThrow(() => subscribeToControl(undefined, () => {})(), 'subscribeToControl with no binding returns a safe no-op unsubscribe, never throws');

  console.log('PASS advanced/resolution: resolveControlRef/trimControlRef, findIntegration/findControl (incl. missing ids), controlSnapshot/subscribeToControl (incl. no binding, unsubscribe, multiple independent subscribers)');
} finally { rmSync(dir, { recursive: true, force: true }); }
