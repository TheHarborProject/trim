// Unit tests for src/react/controls/*.tsx — Trim's default renderers
// (DefaultBooleanControl, DefaultSegmentedControl, DefaultToggleActionControl,
// UnsupportedKindFallback), moved out of src/advanced/widgets.tsx. Each
// calls no hook of its own (value/setValue arrive as plain props — see
// src/react/renderer-contract.ts's TrimControlRendererProps), so each is
// called directly as a plain function here and its RETURNED ELEMENT TREE is
// inspected structurally — same technique used throughout this suite (see
// e.g. panel.test.mjs's own header). Calling a component that secretly used
// a hook this way would throw ("Invalid hook call") the moment React's real
// dispatcher guard fires, since this file requires the real `react` package
// — so every call below succeeding at all is itself part of the proof that
// these renderers are genuinely hook-free, not just documented as such.
//
// src/advanced/widgets.tsx's compatibility re-exports (the old
// ToggleWidget/SegmentedWidget/ToggleActionWidget names) are covered in
// panel.test.mjs, alongside a direct equivalence check against these same
// components. Package-only: compiles nothing outside packages/trim/src.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(root, '.trim-controls-test-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/core/integration.ts', 'src/core/bindings.ts', 'src/react/renderer-contract.ts',
    'src/react/controls/boolean.tsx', 'src/react/controls/segmented.tsx',
    'src/react/controls/toggle-action.tsx', 'src/react/controls/unsupported-fallback.tsx',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const { DefaultBooleanControl } = require(path.join(dir, 'react', 'controls', 'boolean.js'));
  const { DefaultSegmentedControl } = require(path.join(dir, 'react', 'controls', 'segmented.js'));
  const { DefaultToggleActionControl } = require(path.join(dir, 'react', 'controls', 'toggle-action.js'));
  const { UnsupportedKindFallback } = require(path.join(dir, 'react', 'controls', 'unsupported-fallback.js'));

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const resetErrors = () => { errors.length = 0; };

  const noopBind = { get: () => false, set: () => {}, subscribe: () => () => {} };

  // --- DefaultBooleanControl ---
  {
    resetErrors();
    const control = { id: 'value', kind: 'toggle', label: 'Loader initial', binding: noopBind };
    const element = DefaultBooleanControl({ control, value: true, setValue: () => {} });
    assert.equal(element.type, 'label');
    assert.equal(element.props['data-trim-control'], true);
    assert.equal(element.props['data-trim-kind'], 'toggle');
    const [labelSpan, input] = element.props.children;
    assert.equal(labelSpan.props.children, 'Loader initial');
    assert.equal(input.type, 'input');
    assert.equal(input.props.type, 'checkbox');
    assert.equal(input.props.checked, true, 'checked reflects `value`');
    assert.equal(typeof input.props.onChange, 'function', 'wired to setValue, not a static value');
    assert.equal(errors.length, 0);
  }

  // --- DefaultSegmentedControl ---
  {
    resetErrors();
    const control = {
      id: 'value', kind: 'segmented', label: 'Scroll narratif', binding: noopBind,
      options: [{ value: 'full', label: 'Complet' }, { value: 'simplified', label: 'Simplifié' }, { value: 'static', label: 'Statique' }],
    };
    const element = DefaultSegmentedControl({ groupName: 'id-1-narrative-scroll.value', control, value: 'simplified', setValue: () => {} });
    assert.equal(element.type, 'fieldset');
    assert.equal(element.props['data-trim-kind'], 'segmented');
    const legend = element.props.children[0];
    assert.equal(legend.props.children, 'Scroll narratif');
    const optionLabels = element.props.children[1];
    assert.equal(optionLabels.length, 3);
    const [full, simplified] = optionLabels;
    const fullInput = full.props.children[0];
    const simplifiedInput = simplified.props.children[0];
    assert.equal(fullInput.props.type, 'radio');
    assert.equal(fullInput.props.name, 'id-1-narrative-scroll.value', 'radios in one segmented control share the per-instance group name it was given');
    assert.equal(fullInput.props.checked, false, 'not the selected option');
    assert.equal(simplifiedInput.props.checked, true, 'matches the current value');
    assert.equal(errors.length, 0);

    // two independent renders of the SAME control must not collide — different groupName per instance
    const other = DefaultSegmentedControl({ groupName: 'id-2-narrative-scroll.value', control, value: 'simplified', setValue: () => {} });
    const otherFirstInput = other.props.children[1][0].props.children[0];
    assert.notEqual(otherFirstInput.props.name, fullInput.props.name, 'a second instance of the same control gets its own native radio group name');
  }

  // --- DefaultToggleActionControl ---
  {
    resetErrors();
    const control = { id: 'value', kind: 'toggle-action', label: 'Contraste', description: 'Inspecter', binding: noopBind };
    const off = DefaultToggleActionControl({ control, value: false, setValue: () => {} });
    assert.equal(off.type, 'button');
    assert.equal(off.props['data-trim-kind'], 'toggle-action');
    assert.equal(off.props['aria-pressed'], false);
    assert.equal(off.props.children, 'Inspecter', 'uses control.description, not control.label, as the button text');

    const on = DefaultToggleActionControl({ control, value: true, setValue: () => {} });
    assert.equal(on.props['aria-pressed'], true);
    assert.equal(typeof on.props.onClick, 'function');

    const noDescription = DefaultToggleActionControl({ control: { ...control, description: undefined }, value: false, setValue: () => {} });
    assert.equal(noDescription.props.children, 'Contraste', 'falls back to control.label when no description is given');
    assert.equal(errors.length, 0);
  }

  // --- UnsupportedKindFallback ---
  {
    resetErrors();
    const sliderControl = { id: 'value', kind: 'slider', label: 'Not handled yet', binding: noopBind, min: 0, max: 10 };
    let result;
    assert.doesNotThrow(() => { result = UnsupportedKindFallback({ control: sliderControl }); });
    assert.equal(result, null);
    assert.ok(errors.some(e => e.includes('no widget for control kind "slider"')));
  }

  console.error = originalError;

  // --- architectural invariants: no renderer file reaches for the registry, ---
  // --- hooks, or any host-specific token ---
  const stripComments = source => source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/[^\n]*/g, '');       // line comments
  {
    const files = [
      'src/react/controls/boolean.tsx', 'src/react/controls/segmented.tsx',
      'src/react/controls/toggle-action.tsx', 'src/react/controls/unsupported-fallback.tsx',
    ];
    const forbiddenImports = ['../hooks', '../registry-context', '../../core/registry', 'useSyncExternalStore', 'useContext', 'useState', 'useEffect'];
    for (const file of files) {
      const source = stripComments(readFileSync(path.join(root, file), 'utf8'));
      for (const token of forbiddenImports) {
        assert.equal(source.includes(token), false, `${file} must not reference "${token}" — default renderers resolve nothing themselves, they only render what they're given`);
      }
    }
  }

  console.log('PASS react/controls: DefaultBooleanControl, DefaultSegmentedControl (incl. per-instance radio group name), DefaultToggleActionControl, UnsupportedKindFallback (warns, returns null, never throws), no registry/hooks reference in any default renderer file');
} finally { rmSync(dir, { recursive: true, force: true }); }
