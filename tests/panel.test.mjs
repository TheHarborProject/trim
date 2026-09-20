// Tests for the default renderer pieces: src/advanced/widgets.tsx's
// individual kind widgets and src/react/panel.tsx's <Trim.Section>.
//
// ToggleWidget/SegmentedWidget/ToggleActionWidget/UnsupportedKindFallback/
// Section call no hooks of their own (value/setValue/children arrive as
// plain props), so each is called directly as a plain function here and its
// RETURNED ELEMENT TREE is inspected structurally — no renderer/DOM
// involved, same technique used for the JSX parser test. <Trim.Panel>/
// <Trim.Control> themselves (which do call hooks, via
// useTrimControlState/useTrimRegistry) are not exercised this way — that
// needs an actual React render, which this package's test setup (compile +
// require, no test renderer) doesn't provide; covered by ONE:ACCESS's own
// browser-based dogfooding instead. Package-only: compiles nothing outside
// packages/trim/src.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(root, '.trim-panel-test-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/types.ts', 'src/core/settings.ts', 'src/core/registry.ts', 'src/core/integration.ts', 'src/core/bindings.ts',
    'src/react/registry-context.ts', 'src/react/hooks.ts', 'src/react/panel.tsx',
    'src/advanced/resolution.ts', 'src/advanced/sorting.ts', 'src/advanced/widgets.tsx',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const { ToggleWidget, SegmentedWidget, ToggleActionWidget, UnsupportedKindFallback } = require(path.join(dir, 'advanced', 'widgets.js'));
  const { Section } = require(path.join(dir, 'react', 'panel.js'));

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const resetErrors = () => { errors.length = 0; };

  const noopBind = { get: () => false, set: () => {}, subscribe: () => () => {} };

  // --- renderer toggle ---
  {
    resetErrors();
    const control = { id: 'value', kind: 'toggle', label: 'Loader initial', binding: noopBind };
    const element = ToggleWidget({ control, value: true, setValue: () => {} });
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

  // --- renderer segmented ---
  {
    resetErrors();
    const control = {
      id: 'value', kind: 'segmented', label: 'Scroll narratif', binding: noopBind,
      options: [{ value: 'full', label: 'Complet' }, { value: 'simplified', label: 'Simplifié' }, { value: 'static', label: 'Statique' }],
    };
    const element = SegmentedWidget({ groupName: 'id-1-narrative-scroll.value', control, value: 'simplified', setValue: () => {} });
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

    // two independent renders of the SAME control (rendering one control in
    // two places) must not collide — different groupName per instance
    const other = SegmentedWidget({ groupName: 'id-2-narrative-scroll.value', control, value: 'simplified', setValue: () => {} });
    const otherFirstInput = other.props.children[1][0].props.children[0];
    assert.notEqual(otherFirstInput.props.name, fullInput.props.name, 'a second instance of the same control gets its own native radio group name');
  }

  // --- renderer toggle-action ---
  {
    resetErrors();
    const control = { id: 'value', kind: 'toggle-action', label: 'Contraste', description: 'Inspecter', binding: noopBind };
    const off = ToggleActionWidget({ control, value: false, setValue: () => {} });
    assert.equal(off.type, 'button');
    assert.equal(off.props['data-trim-kind'], 'toggle-action');
    assert.equal(off.props['aria-pressed'], false);
    assert.equal(off.props.children, 'Inspecter', 'uses control.description, not control.label, as the button text');

    const on = ToggleActionWidget({ control, value: true, setValue: () => {} });
    assert.equal(on.props['aria-pressed'], true);
    assert.equal(typeof on.props.onClick, 'function');

    const noDescription = ToggleActionWidget({ control: { ...control, description: undefined }, value: false, setValue: () => {} });
    assert.equal(noDescription.props.children, 'Contraste', 'falls back to control.label when no description is given');
    assert.equal(errors.length, 0);
  }

  // --- kind non supporté : n'écrase pas, avertit en dev, rend null ---
  {
    resetErrors();
    const sliderControl = { id: 'value', kind: 'slider', label: 'Not handled yet', binding: noopBind, min: 0, max: 10 };
    let result;
    assert.doesNotThrow(() => { result = UnsupportedKindFallback({ control: sliderControl }); });
    assert.equal(result, null);
    assert.ok(errors.some(e => e.includes('no widget for control kind "slider"')));
  }

  // --- <Trim.Section> : titre, collapsed, children ---
  {
    resetErrors();
    const child = { type: 'span', props: { children: 'inner' } };
    const open = Section({ title: 'Mouvement', children: child });
    assert.equal(open.type, 'details');
    assert.equal(open.props.open, true, 'expanded by default');
    const summaryOpen = open.props.children[0];
    assert.equal(summaryOpen.props.children, 'Mouvement');
    const bodyOpen = open.props.children[1];
    assert.equal(bodyOpen.props.children, child, 'children are passed through, not reinterpreted');

    const collapsed = Section({ title: 'Avancé', collapsed: true, children: child });
    assert.equal(collapsed.props.open, false, 'collapsed prop maps to the native <details> open attribute');
  }

  console.error = originalError;

  // --- aucun token host (ONE:ACCESS ou autre) dans le renderer générique ---
  // Explanatory comments in these files legitimately *name* forbidden
  // tokens (e.g. "no --ink, --surface, ..."), so comments are stripped
  // before scanning — this check is about actual code/CSS, not prose.
  const stripComments = source => source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments (CSS and JS/TS)
    .replace(/\/\/[^\n]*/g, '');       // line comments (JS/TS)
  {
    const panelSource = stripComments(readFileSync(path.join(root, 'src/react/panel.tsx'), 'utf8'));
    const hooksSource = stripComments(readFileSync(path.join(root, 'src/react/hooks.ts'), 'utf8'));
    const widgetsSource = stripComments(readFileSync(path.join(root, 'src/advanced/widgets.tsx'), 'utf8'));
    const cssSource = stripComments(readFileSync(path.join(root, 'src/react/panel.css'), 'utf8'));
    const hostTokens = ['--ink', '--surface', '--signal', '--line-strong', '--font-mono', 'data-theme', 'data-oa-'];
    for (const source of [panelSource, hooksSource, widgetsSource, cssSource]) {
      for (const token of hostTokens) {
        assert.equal(source.includes(token), false, `${token} must not appear in Trim's renderer or its optional stylesheet (outside of comments) — the package must stay usable by any host`);
      }
    }
    assert.equal(/import\s+["'].*\.css["']/.test(panelSource), false, 'panel.tsx imports no stylesheet — panel.css is opt-in only');
    assert.equal(/import\s+["'].*\.css["']/.test(hooksSource), false, 'hooks.ts imports no stylesheet');
  }

  console.log('PASS react/panel + advanced/widgets: toggle widget, segmented widget (incl. per-control radio name), toggle-action widget, unsupported-kind fallback (warns, returns null, never throws), <Trim.Section> title/collapsed/children, no host-specific tokens or stylesheet import in Trim\'s renderer files');
} finally { rmSync(dir, { recursive: true, force: true }); }
