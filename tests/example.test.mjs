// Acceptance test for the default API fixture and canonical CLI templates.
// The fixture supplies controls/config; literal assets come from cli/templates.
// This test treats the assembled fixture as an EXTERNAL CONSUMER would: it
// builds the real package, then resolves the example's
// `@theharborproject/trim*` imports against the real `dist/` output via
// Node/TypeScript's package self-reference (no symlink, no path mapping —
// the same mechanism a real `node_modules` install gives any consumer).
//
// What this can and cannot prove, honestly: everything the example's
// source *declares* (which subpaths it imports, what its manifest/config
// data literally contains, that it typechecks) is verified directly.
// Whether <Trim.Registry>/<Trim.Panel config> actually resolve "theme" to
// "theme.value" and paint the right widget at runtime needs a real React
// render — this package's test suite has never done that (see e.g.
// panel.test.mjs's and controls.test.mjs's own header comments: hook-calling
// components are exercised through ONE:ACCESS's browser-based dogfooding,
// not here) — and reaching for that here would mean either importing
// internal resolution helpers into "a consumer's" test (against this
// file's whole premise) or adding a real renderer dependency, neither of
// which this step calls for. The general resolution mechanism itself
// (bare id -> "<id>.value", is_unique enforcement) is already covered
// against the package's own internals in config.test.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, readdirSync, cpSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });

const exampleDir = mkdtempSync(path.join(root, '.trim-example-fixture-'));
try {
  cpSync(path.join(root, 'tests/fixtures/default'), exampleDir, { recursive: true });
  cpSync(path.join(root, 'cli/templates/default/example'), exampleDir, { recursive: true });

  function listExampleSourceFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...listExampleSourceFiles(full));
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  }
  const sourceFiles = listExampleSourceFiles(exampleDir);
  assert.ok(sourceFiles.length >= 8, 'the example has the expected number of source files');

  // --- every @theharborproject/trim import resolves through a real, ---
  // --- exported public subpath — never an internal src/** path ---
  // Explanatory comments legitimately *name* forbidden patterns (e.g. "no
  // import.meta.glob"), so comments are stripped before scanning — this
  // check is about actual code, not prose (same technique panel.test.mjs
  // already uses for its own host-token scan).
  const stripComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  {
    const require = createRequire(import.meta.url);
    // Matches both `import ... from "spec"` and a bare side-effect import `import "spec"`.
    const importRe = /import\s+(?:.*?\s+from\s+)?["'](@theharborproject\/trim[^"']*)["']/g;
    const seenSpecs = new Set();
    for (const file of sourceFiles) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(importRe)) seenSpecs.add(match[1]);
      assert.doesNotMatch(source, /\bsrc\//, `${path.relative(root, file)} must not reference an internal src/** path`);
      assert.doesNotMatch(source, /import\.meta\.glob/, `${path.relative(root, file)} must not use filesystem-discovery globbing`);
      assert.doesNotMatch(source, /\bimport\(/, `${path.relative(root, file)} must not use dynamic import() discovery`);
    }
    assert.ok(seenSpecs.size >= 3, 'the example imports from more than one @theharborproject/trim subpath');
    for (const spec of seenSpecs) {
      assert.doesNotThrow(
        () => require.resolve(spec, { paths: [exampleDir] }),
        `"${spec}" must resolve through a real exported public subpath`,
      );
    }
    // The whole point of <Trim.Panel config> is that a consumer never needs
    // the granular layout subpath for the default case.
    assert.ok(![...seenSpecs].some(s => s.includes('/react/layouts/') || s.includes('/react/controls/')), 'the example uses <Trim.Panel config>, not a granular renderer/layout import, for its default composition');
  }

  // --- the example typechecks against the real built package, self- ---
  // --- referenced by its own published name — exactly as an installed ---
  // --- consumer's node_modules resolution would see it ---
  execFileSync('node', [
    'node_modules/typescript/bin/tsc', ...sourceFiles.map(f => path.relative(root, f)),
    '--noEmit', '--strict', '--module', 'node16', '--moduleResolution', 'node16', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
  ], { cwd: root });

  // --- compile for real (self-reference needs the output to stay inside ---
  // --- the package tree) and inspect what the manifest/config actually contain ---
  const outDir = mkdtempSync(path.join(root, '.trim-example-test-'));
  try {
    execFileSync('node', [
      'node_modules/typescript/bin/tsc', ...sourceFiles.map(f => path.relative(root, f)),
      '--module', 'node16', '--moduleResolution', 'node16', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
      '--rootDir', path.relative(root, exampleDir), '--outDir', path.relative(root, outDir),
    ], { cwd: root });

    const require = createRequire(import.meta.url);
    const { trimControls } = require(path.join(outDir, 'trim', 'trim.manifest.js'));
    const trimConfig = require(path.join(outDir, 'trim', 'trim.config.js')).default;
    const { CustomContrast } = require(path.join(outDir, 'trim', 'renderers', 'custom-contrast.js'));

    // manifest contains the intended controls, in the SAME lexical id order
    // cli/generators/manifest-file.ts's generateManifestFileContents always
    // produces (this file is now generated by that exact function — see
    // trim.manifest.ts's own "Generated by Trim" header — not hand-ordered).
    assert.deepEqual(trimControls.map(c => c.id), ['animations', 'contrast', 'theme']);
    assert.equal(trimControls.find(c => c.id === 'theme').kind, 'segmented');
    assert.equal(trimControls.find(c => c.id === 'contrast').kind, 'toggle');
    assert.equal(trimControls.find(c => c.id === 'animations').kind, 'segmented');

    // is_unique: false is declared on the intended control, and only there
    assert.equal(trimControls.find(c => c.id === 'animations').is_unique, false);
    assert.ok(!('is_unique' in trimControls.find(c => c.id === 'theme')), 'a control that never set is_unique carries no such key');

    // groups: order is exactly the config array order
    assert.deepEqual(trimConfig.groups.map(g => g.id), ['vision', 'motion']);
    assert.equal(trimConfig.groups[0].label, 'Vision');
    assert.equal(trimConfig.groups[1].label, 'Motion');

    // control order within "vision": bare id, then the custom-renderer object, then a bare id again
    const visionControls = trimConfig.groups[0].controls;
    assert.equal(visionControls[0], 'theme', 'a bare id is used for the default-rendering demo');
    assert.equal(visionControls[1].id, 'contrast');
    assert.equal(visionControls[1].component, CustomContrast, 'the config genuinely references the real, compiled CustomContrast function — not a stand-in');
    assert.equal(visionControls[2], 'animations');

    // is_unique: false control ("animations") is attached in BOTH groups — the repeated
    // composition this control's is_unique: false exists to allow
    assert.equal(trimConfig.groups[1].controls[0], 'animations');
    assert.ok(
      trimConfig.groups.some(g => g.controls.includes('animations')) && trimConfig.groups.filter(g => g.controls.includes('animations')).length === 2,
      '"animations" is attached in exactly two groups',
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  // --- the example is not part of the publishable tarball ---
  {
    const json = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
    const files = JSON.parse(json)[pkg.name].files.map(f => f.path);
    assert.ok(!files.some(f => f.startsWith('examples/')), 'examples/ must never appear in the publishable tarball');
  }

  console.log('PASS default API fixture with canonical CLI templates: every @theharborproject/trim import resolves through a real public subpath (never src/**, never import.meta.glob or dynamic import()), <Trim.Panel config> used over a granular layout import, typechecks against the real built package via self-reference, manifest contains the intended controls with the right kinds, is_unique: false correctly scoped to "animations" only, group/control order is exactly the config array order, the custom renderer is the real compiled function (not a stand-in), "animations" is attached in exactly two groups, and examples/ is excluded from the npm tarball');

} finally {
  rmSync(exampleDir, { recursive: true, force: true });
}
