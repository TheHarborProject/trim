// Unit tests for src/core/registry.ts — framework-agnostic, no React needed.
// Package-only: compiles nothing outside packages/trim/src.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'trim-registry-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/core/registry.ts', 'src/core/integration.ts', 'src/core/bindings.ts',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: path.join(import.meta.dirname, '..') });
  const require = createRequire(import.meta.url);
  const { createTrimRegistry } = require(path.join(dir, 'registry.js'));

  const noopBinding = { get: () => false, set: () => {}, subscribe: () => () => {} };
  const toggle = (id, label) => ({ id, kind: 'toggle', label, binding: noopBinding });
  const descriptor = (id, label, group, controls = {}) => ({ id, meta: { label, group }, controls });

  // --- register / get / list ---
  const registry = createTrimRegistry();
  assert.deepEqual(registry.list(), [], 'empty registry starts with an empty list');
  assert.equal(registry.get('loader'), undefined);

  const loaderV1 = descriptor('loader', 'Loader initial', 'motion', { value: toggle('value', 'Loader initial') });
  registry.register(loaderV1);
  assert.equal(registry.get('loader'), loaderV1);
  assert.deepEqual(registry.list(), [loaderV1]);

  // --- IDs uniques / remplacement idempotent (même id = update, pas doublon) ---
  const loaderV2 = descriptor('loader', 'Loader initial (v2)', 'motion', { value: toggle('value', 'Loader initial (v2)') });
  registry.register(loaderV2);
  assert.equal(registry.list().length, 1, 'registering the same id again replaces, never duplicates');
  assert.equal(registry.get('loader'), loaderV2);

  // --- ordre d'insertion stable, y compris à travers une mise à jour ---
  const scroll = descriptor('narrative-scroll', 'Scroll narratif', 'motion');
  const contrast = descriptor('contrast', 'Contraste', 'vision');
  registry.register(scroll);
  registry.register(contrast);
  assert.deepEqual(registry.list().map(i => i.id), ['loader', 'narrative-scroll', 'contrast'], 'insertion order');
  registry.register(descriptor('loader', 'Loader initial (v3)', 'motion')); // update an early id
  assert.deepEqual(registry.list().map(i => i.id), ['loader', 'narrative-scroll', 'contrast'], 'updating an existing id does not move it');

  // --- unregister ---
  registry.unregister('narrative-scroll');
  assert.deepEqual(registry.list().map(i => i.id), ['loader', 'contrast']);
  assert.equal(registry.get('narrative-scroll'), undefined);
  registry.unregister('does-not-exist'); // no-op, must not throw

  // --- notifications uniquement sur changement sémantique utile ---
  const notifications = [];
  const unsubscribe = registry.subscribe(() => notifications.push(Date.now()));

  registry.register(descriptor('contrast', 'Contraste', 'vision')); // identical content, same id
  assert.equal(notifications.length, 0, 're-registering an unchanged descriptor does not notify');

  registry.register(descriptor('contrast', 'Contraste (renommé)', 'vision')); // label changed
  assert.equal(notifications.length, 1, 'a real content change notifies exactly once');

  registry.register(descriptor('new-integration', 'Nouveau'));
  assert.equal(notifications.length, 2, 'a brand-new id always notifies');

  registry.unregister('new-integration');
  assert.equal(notifications.length, 3, 'unregister notifies');

  registry.unregister('new-integration'); // already gone
  assert.equal(notifications.length, 3, 'unregistering an id that is not present does not notify again');

  unsubscribe();
  registry.register(descriptor('contrast', 'Contraste (encore renommé)', 'vision'));
  assert.equal(notifications.length, 3, 'unsubscribe actually stops delivery');

  // --- pattern StrictMode : mount -> cleanup -> mount doit être un no-op net ---
  const strictRegistry = createTrimRegistry();
  const strictNotifications = [];
  strictRegistry.subscribe(() => strictNotifications.push(1));
  const item = descriptor('loader', 'Loader initial', 'motion');
  strictRegistry.register(item);   // effect (1st invocation)
  strictRegistry.unregister('loader'); // cleanup
  strictRegistry.register(item);   // effect (2nd invocation, StrictMode re-mount)
  assert.deepEqual(strictRegistry.list(), [item], 'double mount/cleanup/mount settles on exactly one entry');
  assert.equal(strictNotifications.length, 3, 'register, unregister and register again each notify once (no coalescing assumed)');

  // double-register with the SAME object reference in a row must not notify twice
  const stableRegistry = createTrimRegistry();
  let stableNotifications = 0;
  stableRegistry.subscribe(() => stableNotifications++);
  const stableItem = descriptor('loader', 'Loader initial', 'motion');
  stableRegistry.register(stableItem);
  stableRegistry.register(stableItem); // same reference, same content
  assert.equal(stableNotifications, 1, 'registering the exact same object twice in a row notifies only once');

  console.log('PASS core/registry: register/get/list, unique ids & idempotent replace, stable insertion order across updates, unregister, notify-only-on-semantic-change, StrictMode mount/cleanup/mount pattern');
} finally { rmSync(dir, { recursive: true, force: true }); }
