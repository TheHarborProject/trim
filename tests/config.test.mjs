// Unit tests for src/react/config.ts — the React-specific composition
// config. No hook, no component: defineTrimConfig, resolveTrimGroups and
// warnOnUniquenessViolations are all plain data functions, exercised
// directly with no renderer needed — same technique used throughout this
// suite. src/react/panel.tsx's own wiring (ConfiguredPanel, which DOES call
// a hook) is covered structurally in panel.test.mjs instead, the same way
// this package has always drawn that line (see e.g. panel.test.mjs's header
// comment). Package-only: compiles nothing outside packages/trim/src.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(root, '.trim-config-test-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/core/bindings.ts', 'src/core/integration.ts', 'src/advanced/resolution.ts', 'src/react/renderer-contract.ts', 'src/react/config.ts',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck',
  ], { cwd: root });

  const require = createRequire(import.meta.url);
  const { defineTrimConfig, resolveTrimGroups, warnOnUniquenessViolations } = require(path.join(dir, 'react', 'config.js'));

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const resetErrors = () => { errors.length = 0; };

  const noopBind = { get: () => undefined, set: () => {}, subscribe: () => () => {} };
  const control = (id, extra = {}) => ({ id, kind: 'toggle', label: id, binding: noopBind, ...extra });
  const integration = (control) => ({ id: control.id, meta: { label: control.label }, controls: { value: control } });

  // --- bare id resolves to "<id>.value"; dotted ref is used literally ---
  {
    const groups = resolveTrimGroups([
      { id: 'vision', controls: ['theme', 'loader.spinnerToggle', { id: 'contrast', component: 'CustomContrast' }] },
    ]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].items.map(i => i.ref), ['theme.value', 'loader.spinnerToggle', 'contrast.value'], 'bare ids get ".value" appended; an already-dotted ref is untouched');
    assert.equal(groups[0].items[0].component, undefined, 'a plain string item has no component override');
    assert.equal(groups[0].items[2].component, 'CustomContrast', 'the object-syntax component override survives resolution unchanged');
  }

  // --- group order and control order are exactly the config array order ---
  {
    const groups = resolveTrimGroups([
      { id: 'motion', controls: ['animations', 'reduced-motion'] },
      { id: 'vision', controls: ['theme', 'zoom', 'contrast'] },
    ]);
    assert.deepEqual(groups.map(g => g.id), ['motion', 'vision'], 'group order matches the config array, not any sort');
    assert.deepEqual(groups[1].items.map(i => i.ref), ['theme.value', 'zoom.value', 'contrast.value'], 'control order within a group matches the config array');
  }

  // --- group label/collapsed pass through unchanged ---
  {
    const groups = resolveTrimGroups([{ id: 'vision', label: 'Vision', collapsed: true, controls: [] }]);
    assert.equal(groups[0].label, 'Vision');
    assert.equal(groups[0].collapsed, true);
  }

  // --- defineTrimConfig: identity, dev-only duplicate-group-id warning ---
  {
    resetErrors();
    const config = { layout: 'sections', groups: [{ id: 'a', controls: [] }] };
    assert.equal(defineTrimConfig(config), config, 'identity at runtime');
    assert.equal(errors.length, 0, 'no duplicate, no warning');
  }
  {
    resetErrors();
    const config = { layout: 'sections', groups: [{ id: 'vision', controls: [] }, { id: 'vision', controls: [] }] };
    defineTrimConfig(config);
    assert.ok(errors.some(e => e.includes('duplicate group id "vision"')), 'a duplicate group id is reported in development');
    assert.equal(errors.length, 1, 'exactly one warning for exactly one duplicate');
  }
  {
    resetErrors();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      defineTrimConfig({ layout: 'sections', groups: [{ id: 'vision', controls: [] }, { id: 'vision', controls: [] }] });
    } finally {
      process.env.NODE_ENV = original;
    }
    assert.equal(errors.length, 0, 'no warning in production, even for a real duplicate group id');
  }

  // --- warnOnUniquenessViolations: undefined/true => duplicate is reported, false => allowed ---
  {
    resetErrors();
    const theme = control('theme'); // is_unique omitted -> undefined -> unique
    const groups = resolveTrimGroups([{ id: 'a', controls: ['theme'] }, { id: 'b', controls: ['theme'] }]);
    warnOnUniquenessViolations(groups, [integration(theme)]);
    assert.ok(errors.some(e => e.includes('control "theme.value" is attached 2 times') && e.includes('is_unique: false')), 'is_unique undefined behaves as unique — a second attachment is reported');
  }
  {
    resetErrors();
    const theme = control('theme', { is_unique: true });
    const groups = resolveTrimGroups([{ id: 'a', controls: ['theme'] }, { id: 'b', controls: ['theme'] }]);
    warnOnUniquenessViolations(groups, [integration(theme)]);
    assert.equal(errors.length, 1, 'is_unique: true behaves the same as undefined — still reported');
  }
  {
    resetErrors();
    const theme = control('theme', { is_unique: false });
    const groups = resolveTrimGroups([{ id: 'a', controls: ['theme'] }, { id: 'b', controls: ['theme'] }]);
    warnOnUniquenessViolations(groups, [integration(theme)]);
    assert.equal(errors.length, 0, 'is_unique: false explicitly allows more than one attachment');
  }
  {
    resetErrors();
    const theme = control('theme');
    const groups = resolveTrimGroups([{ id: 'a', controls: ['theme'] }]); // only one attachment
    warnOnUniquenessViolations(groups, [integration(theme)]);
    assert.equal(errors.length, 0, 'a single attachment never warns, regardless of is_unique');
  }
  {
    resetErrors();
    // "missing" is attached twice but never registered — not a uniqueness
    // violation, that's <Trim.Panel>'s own "no control resolves to ..." case.
    const groups = resolveTrimGroups([{ id: 'a', controls: ['missing'] }, { id: 'b', controls: ['missing'] }]);
    warnOnUniquenessViolations(groups, []);
    assert.equal(errors.length, 0, 'an unresolved ref is not reported as a uniqueness violation');
  }
  {
    resetErrors();
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const theme = control('theme');
      const groups = resolveTrimGroups([{ id: 'a', controls: ['theme'] }, { id: 'b', controls: ['theme'] }]);
      warnOnUniquenessViolations(groups, [integration(theme)]);
    } finally {
      process.env.NODE_ENV = original;
    }
    assert.equal(errors.length, 0, 'no is_unique warning in production, even for a real violation — the function self-gates, callers need not remember to');
  }

  console.error = originalError;
  console.log('PASS react/config: resolveTrimGroups (bare id -> "<id>.value", dotted ref literal, group/control order, component override passthrough), defineTrimConfig (identity, dev-only duplicate-group-id warning), warnOnUniquenessViolations (undefined/true rejected, false allowed, unresolved ref skipped, self-gated in production)');
} finally { rmSync(dir, { recursive: true, force: true }); }
