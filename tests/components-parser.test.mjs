// Unit tests for src/react/components.tsx's children parser
// (buildIntegrationDescriptor and the Trim.* primitives) — exercised by
// building plain React.createElement trees and calling the parser directly,
// with no renderer/DOM/jsdom involved. This is exactly the testability win
// the "passive descriptor" design was chosen for. Package-only: compiles
// nothing outside packages/trim/src.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
// Built inside the package tree so the compiled components.js's require("react") resolves.
const dir = mkdtempSync(path.join(root, '.trim-parser-test-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/core/registry.ts', 'src/core/integration.ts', 'src/core/bindings.ts',
    'src/react/registry-context.ts', 'src/react/manifest.ts', 'src/react/components.tsx',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const React = require('react');
  const { Toggle, Segmented, Option, ToggleAction, Registry, buildIntegrationDescriptor } = require(path.join(dir, 'react', 'components.js'));
  const { TrimRegistryContext, defaultTrimRegistry } = require(path.join(dir, 'react', 'registry-context.js'));

  const noopBind = { get: () => false, set: () => {}, subscribe: () => () => {} };
  const scrollBind = { get: () => 'full', set: () => {}, subscribe: () => () => {} };

  // capture console.error (warnDev) without ever letting it print noise into the test run
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const resetErrors = () => { errors.length = 0; };

  const meta = { label: 'Test' };

  // --- parsing d'un toggle, id par défaut ---
  {
    resetErrors();
    const children = React.createElement(Toggle, { label: 'Loader initial', bind: noopBind });
    const d = buildIntegrationDescriptor('loader', meta, children);
    assert.deepEqual(Object.keys(d.controls), ['value'], 'default control id is "value"');
    assert.equal(d.controls.value.kind, 'toggle');
    assert.equal(d.controls.value.label, 'Loader initial');
    assert.equal(d.controls.value.binding, noopBind, 'binding is passed through by reference, not copied');
    assert.equal(errors.length, 0, 'valid input produces no warning');
  }

  // --- toggle avec id explicite ---
  {
    resetErrors();
    const children = React.createElement(Toggle, { id: 'enabled', label: 'Loader initial', bind: noopBind });
    const d = buildIntegrationDescriptor('loader', meta, children);
    assert.deepEqual(Object.keys(d.controls), ['enabled']);
  }

  // --- toggle-action ---
  {
    resetErrors();
    const children = React.createElement(ToggleAction, { label: 'Contraste', description: 'Inspecter', bind: noopBind });
    const d = buildIntegrationDescriptor('inspect-contrast', meta, children);
    assert.deepEqual(Object.keys(d.controls), ['value']);
    assert.equal(d.controls.value.kind, 'toggle-action');
    assert.equal(d.controls.value.label, 'Contraste');
    assert.equal(d.controls.value.description, 'Inspecter');
    assert.equal(d.controls.value.binding, noopBind);
    assert.equal(errors.length, 0);
  }

  // --- segmented + options ---
  {
    resetErrors();
    const children = React.createElement(
      Segmented,
      { label: 'Scroll narratif', bind: scrollBind },
      React.createElement(Option, { value: 'full' }, 'Complet'),
      React.createElement(Option, { value: 'simplified' }, 'Simplifié'),
      React.createElement(Option, { value: 'static' }, 'Statique'),
    );
    const d = buildIntegrationDescriptor('narrative-scroll', meta, children);
    const control = d.controls.value;
    assert.equal(control.kind, 'segmented');
    assert.deepEqual(control.options.map(o => o.value), ['full', 'simplified', 'static']);
    assert.deepEqual(control.options.map(o => o.label), ['Complet', 'Simplifié', 'Statique']);
    assert.equal(errors.length, 0);
  }

  // --- plusieurs contrôles dans la même intégration ---
  {
    resetErrors();
    const children = [
      React.createElement(Toggle, { id: 'a', key: 'a', label: 'A', bind: noopBind }),
      React.createElement(Toggle, { id: 'b', key: 'b', label: 'B', bind: noopBind }),
    ];
    const d = buildIntegrationDescriptor('multi', meta, children);
    assert.deepEqual(Object.keys(d.controls).sort(), ['a', 'b']);
  }

  // --- tableaux (générés dynamiquement, ex. .map()) ---
  {
    resetErrors();
    const items = [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }, { id: 'z', label: 'Z' }];
    const children = items.map(i => React.createElement(Toggle, { id: i.id, key: i.id, label: i.label, bind: noopBind }));
    const d = buildIntegrationDescriptor('dynamic', meta, children);
    assert.deepEqual(Object.keys(d.controls).sort(), ['x', 'y', 'z']);
    assert.equal(errors.length, 0);
  }

  // --- Fragment ---
  {
    resetErrors();
    const children = React.createElement(
      React.Fragment,
      null,
      React.createElement(Toggle, { id: 'a', label: 'A', bind: noopBind }),
      React.createElement(Toggle, { id: 'b', label: 'B', bind: noopBind }),
    );
    const d = buildIntegrationDescriptor('fragment-test', meta, children);
    assert.deepEqual(Object.keys(d.controls).sort(), ['a', 'b'], 'React.Children does not look inside Fragments on its own — the walker must recurse explicitly');
    assert.equal(errors.length, 0);
  }

  // --- Fragment contenant un tableau (composition des deux cas) ---
  {
    resetErrors();
    const items = [{ id: 'p' }, { id: 'q' }];
    const children = React.createElement(
      React.Fragment,
      null,
      items.map(i => React.createElement(Toggle, { id: i.id, key: i.id, label: i.id, bind: noopBind })),
    );
    const d = buildIntegrationDescriptor('fragment-array', meta, children);
    assert.deepEqual(Object.keys(d.controls).sort(), ['p', 'q']);
  }

  // --- contrôles conditionnels (null / false) ---
  {
    resetErrors();
    const children = [
      React.createElement(Toggle, { id: 'always', key: 'always', label: 'Always', bind: noopBind }),
      false && React.createElement(Toggle, { id: 'never', key: 'never', label: 'Never', bind: noopBind }),
      null,
    ];
    const d = buildIntegrationDescriptor('conditional', meta, children);
    assert.deepEqual(Object.keys(d.controls), ['always'], 'false/null children are silently skipped, not errors');
    assert.equal(errors.length, 0, 'conditional absence never produces a warning');
  }

  // --- IDs dupliqués ---
  {
    resetErrors();
    const children = [
      React.createElement(Toggle, { id: 'same', key: '1', label: 'First', bind: noopBind }),
      React.createElement(Toggle, { id: 'same', key: '2', label: 'Second', bind: noopBind }),
    ];
    const d = buildIntegrationDescriptor('dup', meta, children);
    assert.equal(Object.keys(d.controls).length, 1, 'the later control wins for a duplicate id');
    assert.equal(d.controls.same.label, 'Second');
    assert.ok(errors.some(e => e.includes('duplicate control id')), 'a duplicate id is reported');
  }

  // --- enfants invalides (pas des primitives Trim) ---
  {
    resetErrors();
    const children = [
      React.createElement(Toggle, { id: 'valid', key: 'v', label: 'Valid', bind: noopBind }),
      React.createElement('div', { key: 'd' }, 'not a Trim primitive'),
      'a bare string',
      42,
    ];
    const d = buildIntegrationDescriptor('invalid-children', meta, children);
    assert.deepEqual(Object.keys(d.controls), ['valid'], 'the valid control is still parsed; invalid ones are skipped, not fatal');
    assert.ok(errors.some(e => e.includes('unsupported child')), 'an unsupported child is reported');
  }

  // --- enfant invalide à l'intérieur de <Trim.Segmented> (pas un <Trim.Option>) ---
  {
    resetErrors();
    const children = React.createElement(
      Segmented,
      { label: 'Scroll', bind: scrollBind },
      React.createElement(Option, { value: 'full' }, 'Complet'),
      React.createElement('span', null, 'not an option'),
    );
    const d = buildIntegrationDescriptor('bad-option', meta, children);
    assert.deepEqual(d.controls.value.options.map(o => o.value), ['full']);
    assert.ok(errors.some(e => e.includes('unsupported child') && e.includes('Trim.Segmented')));
  }

  // --- Toggle / Segmented / Option rendus directement (mauvais usage) : avertissent, ne jettent pas ---
  {
    resetErrors();
    const result = Toggle({ label: 'Direct', bind: noopBind });
    assert.equal(result, null, 'rendered directly, it still renders null rather than throwing');
    assert.ok(errors.some(e => e.includes('rendered directly')));
  }

  // --- <Trim.Registry>: render-output shape, with and without `controls` ---
  // Registry itself calls no hook (only its optional ManifestRegistration
  // child does), so — like Section in panel.test.mjs — it's safe to call
  // directly and inspect the returned element tree structurally. What
  // ManifestRegistration's effects actually do (register/unregister via
  // src/react/manifest.ts) is covered in manifest.test.mjs; this only proves
  // <Trim.Registry> wires it in correctly, and leaves it out entirely when
  // `controls` is omitted.
  {
    resetErrors();
    const children = 'hello';
    const element = Registry({ children });
    assert.equal(element.type, TrimRegistryContext.Provider, 'still provides the (default) registry, unchanged');
    assert.equal(element.props.value, defaultTrimRegistry);
    const [manifestSlot, passedChildren] = element.props.children;
    assert.ok(manifestSlot === undefined || manifestSlot === false, 'no `controls` prop — the manifest-registration slot renders nothing, exactly as before this prop existed');
    assert.equal(passedChildren, children, 'children pass through unchanged');
    assert.equal(errors.length, 0);
  }
  {
    resetErrors();
    const registry = { register() {}, unregister() {}, get() {}, list() { return []; }, subscribe() { return () => {}; } };
    const controls = [{ id: 'theme', kind: 'toggle', label: 'Theme', binding: noopBind }];
    const element = Registry({ registry, controls, children: 'x' });
    assert.equal(element.props.value, registry, 'an explicit registry still wins over the default');
    const [manifestElement, passedChildren] = element.props.children;
    assert.ok(React.isValidElement(manifestElement), 'a `controls` prop renders the manifest-registration slot');
    assert.equal(manifestElement.props.registry, registry);
    assert.equal(manifestElement.props.controls, controls);
    assert.equal(passedChildren, 'x', 'children still render alongside the manifest slot');
    assert.equal(errors.length, 0, 'building the element tree alone (no real render) triggers no hook and no warning');
  }

  console.error = originalError;
  console.log('PASS react/components parser: toggle, segmented+options, multiple controls, dynamic arrays, Fragment (incl. Fragment+array), conditional children, duplicate ids, invalid children, direct-render misuse, <Trim.Registry> controls-prop wiring (present vs. omitted)');
} finally { rmSync(dir, { recursive: true, force: true }); }
