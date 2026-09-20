// Unit tests for src/react/layouts/sections.tsx and its internal sibling
// src/react/layouts/render-resolved-control.tsx.
//
// renderResolvedControl calls no hook (control/value/setValue arrive as
// plain arguments), so it's called directly and its RETURNED ELEMENT is
// inspected structurally — same technique used throughout this suite.
// DefaultSectionsLayout itself also calls no hook directly — its body is
// pure JSX-building (React.createElement calls referencing the private,
// hook-calling LayoutItem/GroupSection, which are never actually invoked by
// building an element tree) — so it too is safe to call directly; what
// LayoutItem's hook-calling glue does with what it resolves is proven via
// renderResolvedControl instead, the same split used for
// react/panel.tsx's <Trim.Panel>/<Trim.Control> (not exercised this way —
// see panel.test.mjs's header) versus this suite's usual hook-free pieces.
// Package-only: compiles nothing outside packages/trim/src.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(root, '.trim-layouts-sections-test-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/core/bindings.ts', 'src/core/integration.ts', 'src/core/registry.ts',
    'src/advanced/resolution.ts',
    'src/react/registry-context.ts', 'src/react/hooks.ts', 'src/react/renderer-contract.ts', 'src/react/config.ts',
    'src/react/controls/boolean.tsx', 'src/react/controls/segmented.tsx',
    'src/react/controls/toggle-action.tsx', 'src/react/controls/unsupported-fallback.tsx',
    'src/react/layouts/render-resolved-control.tsx', 'src/react/layouts/sections.tsx',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
  ], { cwd: root });

  const require = createRequire(import.meta.url);
  const React = require('react');
  const { DefaultBooleanControl } = require(path.join(dir, 'react', 'controls', 'boolean.js'));
  const { DefaultSegmentedControl } = require(path.join(dir, 'react', 'controls', 'segmented.js'));
  const { DefaultToggleActionControl } = require(path.join(dir, 'react', 'controls', 'toggle-action.js'));
  const { UnsupportedKindFallback } = require(path.join(dir, 'react', 'controls', 'unsupported-fallback.js'));
  const { resolveTrimGroups } = require(path.join(dir, 'react', 'config.js'));
  const { renderResolvedControl } = require(path.join(dir, 'react', 'layouts', 'render-resolved-control.js'));
  const { DefaultSectionsLayout } = require(path.join(dir, 'react', 'layouts', 'sections.js'));

  // The whole point of this cleanup: the granular subpath must expose only
  // DefaultSectionsLayout, not the internal per-kind dispatch helper too.
  assert.deepEqual(Object.keys(require(path.join(dir, 'react', 'layouts', 'sections.js'))), ['DefaultSectionsLayout']);

  const noopBind = { get: () => undefined, set: () => {}, subscribe: () => () => {} };
  const control = (id, kind, extra = {}) => ({ id, kind, label: id, binding: noopBind, ...extra });

  // --- renderResolvedControl: default dispatch by kind ---
  {
    const el = renderResolvedControl(control('theme', 'toggle'), true, () => {}, 'g');
    assert.equal(el.type, DefaultBooleanControl);
    assert.equal(el.props.value, true);
  }
  {
    const el = renderResolvedControl(control('scroll', 'segmented', { options: [] }), 'full', () => {}, 'group-name-1');
    assert.equal(el.type, DefaultSegmentedControl);
    assert.equal(el.props.groupName, 'group-name-1', 'the per-instance group name is threaded through to the segmented renderer');
  }
  {
    const el = renderResolvedControl(control('pin', 'toggle-action'), false, () => {}, 'g');
    assert.equal(el.type, DefaultToggleActionControl);
  }
  {
    const el = renderResolvedControl(control('volume', 'slider', { min: 0, max: 1 }), 0.5, () => {}, 'g');
    assert.equal(el.type, UnsupportedKindFallback, 'a kind with no default widget falls back, exactly like the auto-discovery path');
  }

  // --- renderResolvedControl: a component override receives exactly {control, value, setValue} ---
  {
    function CustomContrast() { return null; }
    const contrastControl = control('contrast', 'toggle');
    const setValue = () => {};
    const el = renderResolvedControl(contrastControl, true, setValue, 'g', CustomContrast);
    assert.equal(el.type, CustomContrast, 'the override is used instead of any default renderer');
    assert.deepEqual(el.props, { control: contrastControl, value: true, setValue }, 'the override receives exactly the TrimControlRendererProps contract — nothing registry- or binding-shaped leaks in');
  }
  {
    // an override is honored regardless of the control's own kind
    function CustomSlider() { return null; }
    const el = renderResolvedControl(control('volume', 'slider'), 0.5, () => {}, 'g', CustomSlider);
    assert.equal(el.type, CustomSlider, 'an override pre-empts even a kind with no default widget');
  }

  // --- DefaultSectionsLayout: group order, control order, per-item wiring ---
  {
    const groups = resolveTrimGroups([
      { id: 'vision', label: 'Vision', controls: ['theme', 'contrast'] },
      { id: 'motion', controls: ['animations'] },
    ]);
    const registry = { register() {}, unregister() {}, get() {}, list() { return []; }, subscribe() { return () => {}; } };
    const element = DefaultSectionsLayout({ groups, registry });
    assert.equal(element.type, React.Fragment);
    const sections = element.props.children;
    assert.equal(sections.length, 2, 'one rendered group per config group');
    assert.equal(sections[0].props.group, groups[0], 'group order is exactly the config array order — nothing re-sorted or rediscovered');
    assert.equal(sections[1].props.group, groups[1]);

    const visionItems = sections[0].props.children;
    assert.equal(visionItems.length, 2);
    assert.equal(visionItems[0].props.itemRef, 'theme.value', 'control order within a group is exactly the config array order');
    assert.equal(visionItems[1].props.itemRef, 'contrast.value');
    assert.equal(visionItems[0].props.registry, registry, 'registry is threaded down to each item');
  }
  {
    // is_unique: false lets the SAME ref appear twice in one group without a key collision
    const groups = resolveTrimGroups([{ id: 'a', controls: ['theme', 'theme'] }]);
    assert.doesNotThrow(() => DefaultSectionsLayout({ groups }), 'two identical refs in one group build without throwing (distinct React keys, per-index)');
  }

  console.log('PASS react/layouts/sections: renderResolvedControl (default dispatch by kind, component override receives exactly {control, value, setValue}, override pre-empts an unsupported kind), DefaultSectionsLayout (group order, control order, registry threaded per item, repeated ref in one group builds safely)');
} finally { rmSync(dir, { recursive: true, force: true }); }
