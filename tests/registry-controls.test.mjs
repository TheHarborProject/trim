// Regression: manifest controls must resolve during the first render, before
// ManifestRegistration's effect commits to the underlying registry.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const dir = mkdtempSync(path.join(root, '.trim-registry-controls-test-'));
try {
  execFileSync('node', [
    'node_modules/typescript/bin/tsc',
    'src/core/registry.ts', 'src/core/integration.ts', 'src/core/bindings.ts',
    'src/advanced/resolution.ts', 'src/advanced/sorting.ts',
    'src/react/registry-context.ts', 'src/react/manifest.ts', 'src/react/components.tsx',
    'src/react/hooks.ts', 'src/react/renderer-contract.ts', 'src/react/config.ts', 'src/react/panel.tsx',
    'src/react/controls/boolean.tsx', 'src/react/controls/segmented.tsx',
    'src/react/controls/toggle-action.tsx', 'src/react/controls/unsupported-fallback.tsx',
    'src/react/layouts/render-resolved-control.tsx', 'src/react/layouts/sections.tsx',
    'src/react/shell/resolve.ts', 'src/react/shell/vanilla-inline.tsx',
    'src/react/shell/vanilla-popover.tsx', 'src/react/shell/vanilla-dialog.tsx',
    '--outDir', dir, '--module', 'commonjs', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
  ], { cwd: root });
  const require = createRequire(import.meta.url);
  const React = require('react');
  const { Registry } = require(path.join(dir, 'react', 'components.js'));
  const { createManifestRegistryView } = require(path.join(dir, 'react', 'manifest.js'));
  const { resolveTrimGroups } = require(path.join(dir, 'react', 'config.js'));
  const { findControl } = require(path.join(dir, 'advanced', 'resolution.js'));
  const { createTrimRegistry } = require(path.join(dir, 'core', 'registry.js'));
  const binding = { get: () => false, set() {}, subscribe: () => () => {} };
  const control = { id: 'starter', kind: 'toggle', label: 'Starter', binding };
  const baseRegistry = createTrimRegistry();
  const registryElement = Registry({ registry: baseRegistry, controls: [control], children: null });
  const registry = registryElement.props.value;
  const config = { groups: [{ id: 'starter', label: 'Starter', controls: ['starter'] }] };
  const [item] = resolveTrimGroups(config.groups)[0].items;
  assert.ok(findControl(registry.list(), item.ref), 'valid manifest control resolves from the initial render view');
  const invalidRef = resolveTrimGroups([{ id: 'bad', controls: ['missing'] }])[0].items[0].ref;
  assert.equal(findControl(registry.list(), invalidRef), undefined, 'invalid refs remain unresolved');
  console.log('PASS Registry controls resolve from first-render view; invalid refs remain unresolved');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
