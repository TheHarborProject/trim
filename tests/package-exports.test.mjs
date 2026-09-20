// Structural tests for the package's build/export surface: does every
// documented subpath actually resolve through Node's real "exports"
// resolution against the REAL `dist/` output (not an assumption, not an ad
// hoc mini-compile like every other tests/*.mjs), does core's compiled
// output genuinely never touch React, do the granular renderer/layout files
// only require what they need, does @theharborproject/trim/advanced still
// forward to the exact same functions, and does the publishable tarball
// contain only what it should.
//
// This is the one test file in the suite that runs the REAL `npm run build`
// (every other test compiles its own small subset of src/ into a throwaway
// temp dir) — anything less would only prove the package.json config LOOKS
// right, not that it resolves correctly against what actually ships.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const resolveSubpath = (spec) => require.resolve(spec, { paths: [root] });

// --- every documented subpath resolves, to the expected built file ---
const expected = {
  '@theharborproject/trim': 'dist/core/index.js',
  '@theharborproject/trim/react': 'dist/react/index.js',
  '@theharborproject/trim/advanced': 'dist/advanced/index.js',
  '@theharborproject/trim/react/controls/boolean': 'dist/react/controls/boolean.js',
  '@theharborproject/trim/react/controls/segmented': 'dist/react/controls/segmented.js',
  '@theharborproject/trim/react/controls/toggle-action': 'dist/react/controls/toggle-action.js',
  '@theharborproject/trim/react/controls/unsupported-fallback': 'dist/react/controls/unsupported-fallback.js',
  '@theharborproject/trim/react/layouts/sections': 'dist/react/layouts/sections.js',
  '@theharborproject/trim/themes/default.css': 'dist/themes/default.css',
  '@theharborproject/trim/panel.css': 'dist/themes/default.css',
};
for (const [spec, want] of Object.entries(expected)) {
  const got = path.relative(root, resolveSubpath(spec));
  assert.equal(got, want, `${spec} must resolve to ${want}`);
}
assert.equal(
  resolveSubpath('@theharborproject/trim/panel.css'),
  resolveSubpath('@theharborproject/trim/themes/default.css'),
  'panel.css and themes/default.css resolve to the exact same file on disk — one physical implementation, not a copy that can drift',
);

// --- a made-up subpath correctly stays unexported ---
assert.throws(() => resolveSubpath('@theharborproject/trim/nonexistent'), /ERR_PACKAGE_PATH_NOT_EXPORTED/);

// --- core's built output never touches React, even transitively ---
// (blocks react resolution at the Module level, not a static grep, so a
// require() buried three files deep would still be caught)
{
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'react' || request.startsWith('react/')) {
      throw new Error(`core's build reached for "${request}"`);
    }
    return originalResolveFilename.call(this, request, ...rest);
  };
  try {
    delete require.cache[resolveSubpath('@theharborproject/trim')];
    const core = require(resolveSubpath('@theharborproject/trim'));
    assert.ok(Object.keys(core).length > 0, 'core still loads and exports something with react blocked');
  } finally {
    Module._resolveFilename = originalResolveFilename;
  }
}

// --- granular renderer files require only what they need: react's jsx ---
// --- runtime, nothing from ../hooks, ../panel, ../components, or the registry ---
{
  const controlFiles = ['boolean.js', 'segmented.js', 'toggle-action.js', 'unsupported-fallback.js'];
  const forbidden = ['../hooks', '../panel', '../components', '../../core/registry', '../registry-context', '../config'];
  for (const file of controlFiles) {
    const source = readFileSync(path.join(root, 'dist/react/controls', file), 'utf8');
    for (const token of forbidden) {
      assert.equal(source.includes(`require("${token}")`), false, `dist/react/controls/${file} must not require "${token}"`);
    }
  }
}

// --- DefaultSectionsLayout pulls in hooks + its internal dispatch sibling, ---
// --- never the legacy auto-discovery file or the JSX declaration parser ---
{
  const source = readFileSync(path.join(root, 'dist/react/layouts/sections.js'), 'utf8');
  for (const expectedRequire of ['../hooks', './render-resolved-control']) {
    assert.ok(source.includes(`require("${expectedRequire}")`), `sections.js should require "${expectedRequire}"`);
  }
  for (const forbiddenRequire of ['../panel', '../components', '../manifest']) {
    assert.equal(source.includes(`require("${forbiddenRequire}")`), false, `sections.js must not require "${forbiddenRequire}"`);
  }
}

// --- the granular subpath exposes ONLY DefaultSectionsLayout — the ---
// --- per-kind dispatch helper (render-resolved-control.js) is an internal ---
// --- sibling with no export-map subpath of its own, so it stays unreachable ---
{
  delete require.cache[resolveSubpath('@theharborproject/trim/react/layouts/sections')];
  const sections = require(resolveSubpath('@theharborproject/trim/react/layouts/sections'));
  assert.deepEqual(Object.keys(sections), ['DefaultSectionsLayout'], 'no other symbol leaks through this subpath');
  assert.throws(
    () => require.resolve('@theharborproject/trim/react/layouts/render-resolved-control', { paths: [root] }),
    /ERR_PACKAGE_PATH_NOT_EXPORTED/,
    'render-resolved-control has no export-map subpath of its own',
  );
}

// --- /advanced compatibility remains functional end to end against the REAL built files ---
{
  delete require.cache[resolveSubpath('@theharborproject/trim/advanced')];
  delete require.cache[resolveSubpath('@theharborproject/trim/react/controls/boolean')];
  const advanced = require(resolveSubpath('@theharborproject/trim/advanced'));
  const { DefaultBooleanControl } = require(resolveSubpath('@theharborproject/trim/react/controls/boolean'));
  const noopBind = { get: () => false, set: () => {}, subscribe: () => () => {} };
  const props = { control: { id: 'x', kind: 'toggle', label: 'X', binding: noopBind }, value: true, setValue: () => {} };
  assert.equal(advanced.ToggleWidget(props).type, DefaultBooleanControl, 'advanced/widgets.tsx forwards to the real, currently-built DefaultBooleanControl — not a stale or duplicated copy');
}

// --- sideEffects names exactly the one real CSS output, nothing stale ---
assert.deepEqual(pkg.sideEffects, ['./dist/themes/default.css']);
assert.ok(existsSync(path.join(root, 'dist/themes/default.css')), 'the declared side-effect file actually exists in dist');

// --- tarball contains only publishable artifacts: dist/**, package.json, README, LICENSE ---
{
  const json = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
  const manifest = JSON.parse(json)[pkg.name];
  assert.ok(manifest, `npm pack --json output keyed by "${pkg.name}"`);
  const files = manifest.files.map(f => f.path);
  assert.ok(files.length > 0);
  const allowedTopLevel = new Set(['LICENSE', 'README.md', 'package.json']);
  for (const file of files) {
    const ok = file.startsWith('dist/') || allowedTopLevel.has(file);
    assert.ok(ok, `unexpected file in the publishable tarball: ${file}`);
  }
  for (const forbiddenPrefix of ['tests/', 'src/', 'examples/', 'cli/', '.vscode/', 'tsconfig']) {
    assert.ok(!files.some(f => f.startsWith(forbiddenPrefix)), `the tarball must not contain anything under "${forbiddenPrefix}"`);
  }
  assert.ok(files.includes('dist/themes/default.css'));
  assert.ok(files.includes('dist/react/controls/boolean.js'));
  assert.ok(files.includes('dist/react/controls/unsupported-fallback.js'));
  assert.ok(files.includes('dist/react/layouts/sections.js'));
}

console.log('PASS package exports: every documented subpath resolves against the real dist/ build (panel.css and themes/default.css alias to the identical file), unlisted subpaths correctly rejected, core never touches React even transitively, granular renderer files require nothing beyond react\'s jsx runtime, DefaultSectionsLayout pulls in hooks + controls but never the legacy panel/components files, /advanced forwards to the real currently-built controls, sideEffects names exactly one real file, and the publishable tarball contains only dist/**, package.json, README, LICENSE');
