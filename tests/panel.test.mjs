// Tests for src/react/panel.tsx's <Trim.Section> and <Trim.Panel> (the
// config/children/auto-discovery precedence only — see below), and for
// src/advanced/widgets.tsx's compatibility re-exports (ToggleWidget/
// SegmentedWidget/ToggleActionWidget/UnsupportedKindFallback) now that their
// actual implementations live in src/react/controls/*.tsx — see
// controls.test.mjs for the canonical DefaultBooleanControl/
// DefaultSegmentedControl/DefaultToggleActionControl/UnsupportedKindFallback
// behavior tests, and config.test.mjs / layouts-sections.test.mjs for
// resolveTrimGroups/warnOnUniquenessViolations/DefaultSectionsLayout.
//
// Section and Panel call no hook of their own (children/config/registry
// arrive as plain props — the hook-calling work is in AutoPanel/
// ConfiguredPanel, private to this file), so both are called directly as
// plain functions here and their RETURNED ELEMENT TREE is inspected
// structurally — same technique used for the JSX parser test.
// AutoPanel/ConfiguredPanel themselves (which DO call hooks, via
// useTrimRegistry) are not exercised this way — that needs an actual React
// render, which this package's test setup (compile + require, no test
// renderer) doesn't provide; covered by ONE:ACCESS's own browser-based
// dogfooding instead. Package-only: compiles nothing outside
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
    'src/react/registry-context.ts', 'src/react/hooks.ts', 'src/react/renderer-contract.ts', 'src/react/config.ts', 'src/react/panel.tsx',
    'src/react/controls/boolean.tsx', 'src/react/controls/segmented.tsx',
    'src/react/controls/toggle-action.tsx', 'src/react/controls/unsupported-fallback.tsx', 'src/react/layouts/sections.tsx',
    'src/react/shell/resolve.ts', 'src/react/shell/vanilla-inline.tsx', 'src/react/shell/vanilla-popover.tsx',
    'src/react/shell/vanilla-dialog.tsx', 'src/react/shell/use-shell-dismiss.ts',
    'src/advanced/resolution.ts', 'src/advanced/sorting.ts', 'src/advanced/widgets.tsx',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const { Section, Panel } = require(path.join(dir, 'react', 'panel.js'));
  const { DefaultBooleanControl } = require(path.join(dir, 'react', 'controls', 'boolean.js'));
  const { DefaultSegmentedControl } = require(path.join(dir, 'react', 'controls', 'segmented.js'));
  const { DefaultToggleActionControl } = require(path.join(dir, 'react', 'controls', 'toggle-action.js'));
  const { UnsupportedKindFallback: DefaultUnsupportedKindFallback } = require(path.join(dir, 'react', 'controls', 'unsupported-fallback.js'));
  const { ToggleWidget, SegmentedWidget, ToggleActionWidget, UnsupportedKindFallback } = require(path.join(dir, 'advanced', 'widgets.js'));

  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const resetErrors = () => { errors.length = 0; };

  const noopBind = { get: () => false, set: () => {}, subscribe: () => () => {} };

  // --- advanced/widgets.tsx compatibility: still resolves, still forwards ---
  // --- to the exact same component as its react/controls/* counterpart ---
  // (calling e.g. ToggleWidget(props) returns an element WRAPPING
  // DefaultBooleanControl, not its rendered output — asserting on `.type`
  // is what actually proves "one implementation, forwarded", not a second
  // one that happens to look similar).
  {
    resetErrors();
    const control = { id: 'value', kind: 'toggle', label: 'Loader initial', binding: noopBind };
    const props = { control, value: true, setValue: () => {} };
    const wrapped = ToggleWidget(props);
    assert.equal(wrapped.type, DefaultBooleanControl, 'ToggleWidget forwards to the exact same DefaultBooleanControl function');
    assert.deepEqual(wrapped.props, props, 'props pass through unchanged');
    assert.equal(errors.length, 0);
  }
  {
    resetErrors();
    const control = {
      id: 'value', kind: 'segmented', label: 'Scroll narratif', binding: noopBind,
      options: [{ value: 'full', label: 'Complet' }, { value: 'simplified', label: 'Simplifié' }],
    };
    const props = { groupName: 'g', control, value: 'simplified', setValue: () => {} };
    const wrapped = SegmentedWidget(props);
    assert.equal(wrapped.type, DefaultSegmentedControl, 'SegmentedWidget forwards to the exact same DefaultSegmentedControl function');
    assert.deepEqual(wrapped.props, props, 'props pass through unchanged');
  }
  {
    resetErrors();
    const control = { id: 'value', kind: 'toggle-action', label: 'Contraste', description: 'Inspecter', binding: noopBind };
    const props = { control, value: false, setValue: () => {} };
    const wrapped = ToggleActionWidget(props);
    assert.equal(wrapped.type, DefaultToggleActionControl, 'ToggleActionWidget forwards to the exact same DefaultToggleActionControl function');
    assert.deepEqual(wrapped.props, props, 'props pass through unchanged');
  }
  {
    resetErrors();
    assert.equal(UnsupportedKindFallback, DefaultUnsupportedKindFallback, 'advanced/widgets.tsx re-exports the exact same UnsupportedKindFallback function, not a copy');
  }

  // --- <Trim.Section> : title, collapsed, children ---
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

  // --- <Trim.Panel>: config / children / auto-discovery precedence ---
  // ConfiguredPanel/AutoPanel are private (not exported), so branches are
  // told apart the same way step 2's <Trim.Registry> test told
  // ManifestRegistration apart from nothing: by the shape of the inner
  // element's own props, not by importing an internal name.
  {
    resetErrors();
    const registry = { register() {}, unregister() {}, get() {}, list() { return []; }, subscribe() { return () => {}; } };
    const config = { layout: 'sections', groups: [] };

    // no config, no children -> auto-discovery (unchanged 0.1 behavior)
    const auto = Panel({ registry });
    assert.equal(auto.type, 'div');
    assert.equal(auto.props['data-trim-panel'], true);
    const autoInner = auto.props.children;
    assert.ok(autoInner && typeof autoInner.type === 'function', 'renders through a component (AutoPanel), not raw markup');
    assert.ok(!('config' in autoInner.props), 'the auto-discovery branch never carries a `config` prop — distinguishes it from the config-driven branch below');
    assert.equal(errors.length, 0);

    // config, no children -> config-driven path
    resetErrors();
    const configured = Panel({ config, registry });
    const configuredInner = configured.props.children;
    assert.ok(configuredInner && typeof configuredInner.type === 'function');
    assert.equal(configuredInner.props.config, config, 'the resolved config-driven branch receives the exact config object');
    assert.equal(configuredInner.props.registry, registry);
    assert.equal(errors.length, 0, 'config alone, with no children, warns nothing');

    // children alone -> unopinionated container (unchanged 0.1 behavior)
    resetErrors();
    const child = { type: 'span', props: { children: 'inner' } };
    const withChildren = Panel({ children: child });
    assert.equal(withChildren.props.children, child, 'children pass through exactly, no auto-discovery, no config resolution');
    assert.equal(errors.length, 0);

    // both config AND children -> children win, but it is not silent
    resetErrors();
    const both = Panel({ config, children: child });
    assert.equal(both.props.children, child, 'children still win when both are given — the same precedence children already had over auto-discovery before `config` existed');
    assert.ok(errors.some(e => e.includes('received both `config` and `children`') && e.includes('config` is ignored')), 'the ignored `config` is reported, not silently dropped');
  }

  console.error = originalError;

  // --- no host token (ONE:ACCESS or otherwise) in the generic renderer ---
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
    const controlsSources = [
      'src/react/controls/boolean.tsx', 'src/react/controls/segmented.tsx',
      'src/react/controls/toggle-action.tsx', 'src/react/controls/unsupported-fallback.tsx',
    ].map(file => stripComments(readFileSync(path.join(root, file), 'utf8')));
    const cssSource = stripComments(readFileSync(path.join(root, 'src/themes/default.css'), 'utf8'));
    const hostTokens = ['--ink', '--surface', '--signal', '--line-strong', '--font-mono', 'data-theme', 'data-oa-'];
    for (const source of [panelSource, hooksSource, widgetsSource, cssSource, ...controlsSources]) {
      for (const token of hostTokens) {
        assert.equal(source.includes(token), false, `${token} must not appear in Trim's renderer or its optional stylesheet (outside of comments) — the package must stay usable by any host`);
      }
    }
    assert.equal(/import\s+["'].*\.css["']/.test(panelSource), false, 'panel.tsx imports no stylesheet — panel.css is opt-in only');
    assert.equal(/import\s+["'].*\.css["']/.test(hooksSource), false, 'hooks.ts imports no stylesheet');
  }

  console.log('PASS react/panel + advanced/widgets compatibility: <Trim.Section> title/collapsed/children, <Trim.Panel> config/children/auto-discovery precedence (children always win, config-vs-children is reported not silent, auto-discovery unchanged), ToggleWidget/SegmentedWidget/ToggleActionWidget/UnsupportedKindFallback forward identically to their react/controls/* implementations, no host-specific tokens or stylesheet import in Trim\'s renderer files');
} finally { rmSync(dir, { recursive: true, force: true }); }
