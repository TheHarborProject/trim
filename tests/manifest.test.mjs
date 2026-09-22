// Unit tests for src/react/manifest.ts — the internal adapter from a flat,
// manifest-declared TrimControl list to the existing integration-based
// registry. No React import in the source, so no JSX/renderer needed here
// either: toIntegration/registerManifestControls/unregisterManifestControls
// are plain functions over a real TrimRegistry (src/core/registry.ts),
// exercised directly — same technique used throughout this suite. The
// wiring in src/react/components.tsx (ManifestRegistration's useRef/useEffect
// pair) is intentionally NOT exercised here: it contains no logic of its own
// beyond calling these two functions and stashing the returned Set in a ref
// — see components-parser.test.mjs for the one React-facing check that
// covers <Trim.Registry>'s own render output instead (this package's test
// setup has no renderer to actually fire effects — see panel.test.mjs's
// header comment for the established precedent).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(root, '.trim-manifest-test-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/core/index.ts', 'src/core/bindings.ts', 'src/core/integration.ts', 'src/core/registry.ts', 'src/advanced/resolution.ts', 'src/react/manifest.ts', 'src/react/config.ts',
    '--jsx', 'react-jsx',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: root });

  const require = createRequire(import.meta.url);
  const { toIntegration, registerManifestControls, unregisterManifestControls } = require(path.join(dir, 'react', 'manifest.js'));
  const { createTrimRegistry } = require(path.join(dir, 'core', 'registry.js'));
  const { findControl } = require(path.join(dir, 'advanced', 'resolution.js'));

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const resetErrors = () => { errors.length = 0; };

  const noopBind = { get: () => false, set: () => {}, subscribe: () => () => {} };
  const control = (id, label, description) => ({ id, kind: 'toggle', label, description, binding: noopBind });

  // The actual headless fixture must resolve every configured reference
  // through the same manifest adapter/resolver used by the panel.
  {
    const ts = require('typescript');
    const core = require(path.join(dir, 'core', 'index.js'));
    const configApi = require(path.join(dir, 'react', 'config.js'));
    const cache = new Map();
    const loadFixture = (file) => {
      if (cache.has(file)) return cache.get(file);
      const output = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText;
      const module = { exports: {} };
      const fixtureRequire = (id) => {
        if (id === '@theharborproject/trim') return core;
        if (id === '@theharborproject/trim/react') return configApi;
        assert.ok(id.startsWith('.'), `unexpected fixture import: ${id}`);
        return loadFixture(path.resolve(path.dirname(file), `${id}.ts`));
      };
      new Function('require', 'module', 'exports', output)(fixtureRequire, module, module.exports);
      cache.set(file, module.exports);
      return module.exports;
    };
    const fixture = path.join(root, 'examples/headless/trim');
    const config = loadFixture(path.join(fixture, 'trim.config.tsx')).default;
    const { trimControls } = loadFixture(path.join(fixture, 'trim.manifest.ts'));
    assert.deepEqual(trimControls.map(({ id }) => id), ['starter']);
    assert.deepEqual(config.groups.map(({ id }) => id), ['starter']);
    const registry = createTrimRegistry();
    registerManifestControls(registry, trimControls, new Set());
    for (const group of configApi.resolveTrimGroups(config.groups)) {
      for (const item of group.items) {
        assert.ok(findControl(registry.list(), item.ref), `unresolved fixture control: ${item.ref}`);
      }
    }
    assert.equal(errors.length, 0, 'headless fixture resolves without warnings');
  }

  // --- toIntegration: one control -> one integration, keyed "value" ---
  {
    const theme = control('theme', 'Theme', 'Light or dark');
    const integration = toIntegration(theme);
    assert.deepEqual(integration, { id: 'theme', meta: { label: 'Theme', description: 'Light or dark' }, controls: { value: theme } });
    assert.equal(integration.controls.value, theme, 'the control is stored by reference, not cloned');
  }

  // --- registerManifestControls: one control resolves as "<id>.value" through the real resolver ---
  {
    resetErrors();
    const registry = createTrimRegistry();
    const theme = control('theme', 'Theme');
    const ids = registerManifestControls(registry, [theme], new Set());
    assert.deepEqual([...ids], ['theme']);
    assert.equal(registry.get('theme').controls.value, theme);
    assert.equal(findControl(registry.list(), 'theme.value'), theme, 'resolves through the same findControl() useTrimControlState/panel.tsx already use');
    assert.equal(errors.length, 0, 'no duplicates, no warning');
  }

  // --- multiple controls register correctly ---
  {
    resetErrors();
    const registry = createTrimRegistry();
    const a = control('a', 'A'), b = control('b', 'B'), c = control('c', 'C');
    const ids = registerManifestControls(registry, [a, b, c], new Set());
    assert.deepEqual([...ids].sort(), ['a', 'b', 'c']);
    assert.deepEqual(registry.list().map(i => i.id), ['a', 'b', 'c'], 'insertion order preserved');
    assert.equal(findControl(registry.list(), 'b.value'), b);
  }

  // --- cleanup (unregisterManifestControls) removes exactly what was registered ---
  {
    const registry = createTrimRegistry();
    const a = control('a', 'A'), b = control('b', 'B');
    const ids = registerManifestControls(registry, [a, b], new Set());
    unregisterManifestControls(registry, ids);
    assert.deepEqual(registry.list(), [], 'both controls are gone');
    assert.doesNotThrow(() => unregisterManifestControls(registry, ids), 'unregistering an already-gone id set is a no-op, not an error');
  }

  // --- churn avoidance: only ids that actually dropped out are unregistered, ---
  // --- and an unchanged control never spuriously re-notifies ---
  {
    const registry = createTrimRegistry();
    const notifications = [];
    registry.subscribe(() => notifications.push(1));

    const a = control('a', 'A'), b = control('b', 'B');
    let ids = registerManifestControls(registry, [a, b], new Set());
    assert.equal(notifications.length, 2, 'two brand-new controls notify once each');

    const c = control('c', 'C');
    ids = registerManifestControls(registry, [a, c], ids); // b dropped, c added, a unchanged
    assert.deepEqual(registry.list().map(i => i.id), ['a', 'c'], 'b was removed, c was added, a stayed');
    assert.equal(
      notifications.length,
      2 + 2,
      'exactly two more notifications this round (c registered, b unregistered) — re-registering unchanged "a" does not notify, and it is never unregistered-then-reregistered',
    );
  }

  // --- duplicate ids: deterministic (later wins) + reported in dev ---
  {
    resetErrors();
    const registry = createTrimRegistry();
    const first = control('theme', 'First');
    const second = control('theme', 'Second');
    const ids = registerManifestControls(registry, [first, second], new Set());
    assert.deepEqual([...ids], ['theme'], 'a duplicate id collapses to one entry');
    assert.equal(registry.get('theme').controls.value, second, 'the later control in the array wins, deterministically');
    assert.ok(errors.some(e => e.includes('duplicate control id "theme"')), 'a duplicate id is reported in development');
    assert.equal(errors.length, 1, 'exactly one warning for exactly one duplicate — no double-reporting');
  }

  // --- duplicate-id scan is skipped outside development ---
  {
    resetErrors();
    const registry = createTrimRegistry();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      registerManifestControls(registry, [control('theme', 'First'), control('theme', 'Second')], new Set());
    } finally {
      process.env.NODE_ENV = original;
    }
    assert.equal(errors.length, 0, 'no warning is emitted in production, even for a real duplicate');
  }

  console.error = originalError;
  console.log('PASS react/manifest: toIntegration (one control -> one "<id>.value" integration), registerManifestControls (single + multiple controls, resolves through findControl), unregisterManifestControls (cleanup, idempotent), diff-based churn avoidance (no spurious notify for unchanged controls), deterministic duplicate-id handling (later wins, warns once in dev, silent in production)');
} finally { rmSync(dir, { recursive: true, force: true }); }
