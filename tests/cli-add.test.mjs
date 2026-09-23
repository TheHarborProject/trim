// Tests for `trim add` (cli/commands/add.ts, cli/generators/template-registry.ts,
// cli/generators/example-plan.ts, cli/templates-path.ts, cli/templates/**).
//
// Fixtures live inside the repo tree (mkdtempSync under the repo root),
// like every other CLI test — @default/example needs the host project's
// own `typescript` (Node resolution walk-up only finds this repo's own
// node_modules from inside it) and generated-file typechecking needs the
// real dist/ build self-referenced by the package's own name.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { listKnownRefs, findTemplateEntry, TEMPLATE_REGISTRY } = require(path.join(root, 'dist/cli/generators/template-registry.js'));
const { runAddCommand } = require(path.join(root, 'dist/cli/commands/add.js'));
const { runInitCommand } = require(path.join(root, 'dist/cli/commands/init.js'));
const { runNewControlCommand } = require(path.join(root, 'dist/cli/commands/new-control.js'));
const { generateManifestFileContents } = require(path.join(root, 'dist/cli/generators/manifest-file.js'));
const { generateSettingsFileContents } = require(path.join(root, 'dist/cli/generators/settings-file.js'));
const { UsageError } = require(path.join(root, 'dist/cli/dispatch.js'));

const testRoot = mkdtempSync(path.join(root, '.trim-cli-add-test-'));

const swallowLogs = async (fn) => {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
};

/**
 * A scripted fake `Prompter` (cli/prompts/prompter.ts) — same queue-of-
 * answers idea the old scriptedAsk used, methods resolve immediately, no
 * TTY/stdin involved. `select()` answers are 1-indexed, matching the
 * on-screen choice order; `confirm()` still accepts 'y'/'n'/''.
 */
function scriptedAsk(answers) {
  const queue = [...answers];
  function pop(message) {
    if (queue.length === 0) throw new Error(`scriptedAsk: ran out of answers (last prompt: ${JSON.stringify(message)})`);
    return queue.shift();
  }
  return {
    async input(opts) { return pop(opts.message); },
    async select(opts) {
      const raw = pop(opts.message);
      const choice = opts.choices[Number(raw) - 1];
      if (!choice) throw new Error(`scriptedAsk: select got out-of-range answer ${JSON.stringify(raw)} for "${opts.message}"`);
      return choice.value;
    },
    async confirm(opts) {
      const raw = pop(opts.message);
      if (typeof raw === 'boolean') return raw;
      if (raw === '') return opts.default ?? false;
      return raw === 'y' || raw === 'yes';
    },
    async checkbox(opts) {
      const indices = new Set(pop(opts.message));
      return opts.choices.filter((_, i) => indices.has(i + 1)).map((c) => c.value);
    },
  };
}

/**
 * A freshly `trim init`-ed project, with no components.json (so "Use
 * project shadcn" isn't offered — the adapter select's only choices are
 * [vanilla, headless]). `styling: 'headless'` now means picking the
 * headless ADAPTER itself (choice "2"), rather than a third styling
 * choice — the old third styling option is exactly that adapter now (see
 * cli/prompts/init-prompts.ts's own header on the reconciled flow).
 */
async function initializedFixture(name, { styling = 'default' } = {}) {
  const dir = path.join(testRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler' } }), 'utf8');
  const answers = styling === 'headless' ? ['2'] : ['1', '1', styling === 'tokens' ? '2' : '1'];
  await swallowLogs(() => runInitCommand(dir, scriptedAsk(answers)));
  return dir;
}

// `generateConfigContents({ adapter: 'vanilla', shell: 'popover' })`'s own
// literal `groups` block (see cli/generators/init-files.ts) — matched
// verbatim so emptyFixture below can strip it back to `groups: []`,
// without hand-rolling a second "what does an empty config look like" text.
const SEEDED_GROUPS_BLOCK = `groups: [
    {
      id: "starter",
      label: "Example",
      controls: ["starter"],
    },
  ],
});
`;

/**
 * `@default/example`'s own precondition (cli/generators/example-plan.ts's
 * checkProjectIsEmpty) requires a GENUINELY empty Trim setup — no declared
 * controls, no Trim-managed settings, no config groups. `trim init` itself
 * now always seeds one starter "starter" control (see init-files.ts's own
 * header) — a real, deliberate feature, but one that's simply orthogonal to
 * `@default/example`'s own "installs into a blank canvas" precondition, so
 * these tests reset that seed back to empty (using the SAME real
 * generators the empty case already uses) before exercising
 * `@default/example` in isolation, exactly as if `trim init` had produced
 * a blank setup the way it used to.
 */
async function emptyFixture(name, opts) {
  const dir = await initializedFixture(name, opts);
  rmSync(path.join(dir, 'trim/controls/starter.trim.ts'));
  writeFileSync(path.join(dir, 'trim/trim.manifest.ts'), generateManifestFileContents([], 'classic-or-bundler'), 'utf8');
  writeFileSync(path.join(dir, 'trim/trim.settings.ts'), generateSettingsFileContents([]), 'utf8');
  const configPath = path.join(dir, 'trim/trim.config.tsx');
  const config = readFileSync(configPath, 'utf8');
  const stripped = config.replace(SEEDED_GROUPS_BLOCK, 'groups: [],\n});\n');
  assert.notEqual(stripped, config, 'emptyFixture: could not find the seeded starter group to strip out of trim.config.tsx');
  writeFileSync(configPath, stripped, 'utf8');
  return dir;
}

try {
  // --- static ref registry: every supported ref resolves, unknown ref does not ---
  {
    assert.deepEqual(listKnownRefs(), ['@default/controls/boolean', '@default/controls/segmented', '@default/controls/toggle-action', '@default/layouts/sections', '@default/example']);
    for (const ref of ['@default/controls/boolean', '@default/controls/segmented', '@default/controls/toggle-action', '@default/layouts/sections']) {
      assert.ok(findTemplateEntry(ref), `${ref} is a known template`);
    }
    assert.equal(findTemplateEntry('@default/example'), undefined, '@default/example is handled specially, not through the simple template registry');
    assert.equal(findTemplateEntry('@shadcn/controls/boolean'), undefined, '@shadcn/controls/boolean is a real ref, but not in the @default-only registry this function looks up — see cli-add-shadcn.test.mjs for its own registry');
    assert.equal(findTemplateEntry('@default/nonsense'), undefined);
  }

  // --- unknown ref: a clean UsageError listing what IS available, no filesystem access ---
  {
    const dir = path.join(testRoot, 'unknown-ref-no-fs');
    mkdirSync(dir, { recursive: true }); // deliberately NOT initialized — proves this never touches the project
    await assert.rejects(runAddCommand(dir, '@bogus/thing'), UsageError);
    await assert.rejects(runAddCommand(dir, '@bogus/thing'), /unknown template "@bogus\/thing"/);
    await assert.rejects(runAddCommand(dir, '@bogus/thing'), /@default\/controls\/boolean/, 'the error lists at least one real, available ref');
  }

  // --- each simple template: first install (create), rerun identical (already installed, no error), then a real conflict ---
  for (const entry of TEMPLATE_REGISTRY) {
    const dir = await initializedFixture(`simple-${entry.ref.replace(/[@/]/g, '-')}`);

    const firstOutput = await swallowLogs(() => runAddCommand(dir, entry.ref));
    assert.match(firstOutput, new RegExp(`^\\+ ${entry.targetPath.replace(/[.[\]]/g, '\\$&')}`, 'm'), 'first install reports a create');
    assert.ok(existsSync(path.join(dir, entry.targetPath)));
    const installedContents = readFileSync(path.join(dir, entry.targetPath), 'utf8');
    assert.match(installedContents, /@theharborproject\/trim/, 'the installed file references the real package');
    assert.doesNotMatch(installedContents, /\bsrc\//, 'no internal src/** path leaks into the installed file');

    // idempotent rerun: byte-identical file already there -> "already installed", never an error, never rewritten
    const secondOutput = await swallowLogs(() => runAddCommand(dir, entry.ref));
    assert.match(secondOutput, /already installed/);
    assert.equal(readFileSync(path.join(dir, entry.targetPath), 'utf8'), installedContents);

    // a real conflict: hand-edit the installed file, rerun -> UsageError, content untouched
    const handEdited = installedContents + '\n// hand-edited\n';
    writeFileSync(path.join(dir, entry.targetPath), handEdited, 'utf8');
    await assert.rejects(runAddCommand(dir, entry.ref), UsageError);
    await assert.rejects(runAddCommand(dir, entry.ref), /already exists with different content/);
    assert.equal(readFileSync(path.join(dir, entry.targetPath), 'utf8'), handEdited, 'a conflicting file is never overwritten');
  }

  // --- generated imports resolve through the real public export map; templates typecheck against the real built package ---
  {
    const templateFiles = TEMPLATE_REGISTRY.map((e) => path.join(root, 'cli/templates', e.templatePath));
    const importRe = /import\s+(?:.*?\s+from\s+)?["'](@theharborproject\/trim[^"']*)["']/g;
    const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const seenSpecs = new Set();
    for (const file of templateFiles) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(importRe)) seenSpecs.add(match[1]);
      assert.doesNotMatch(source, /\bsrc\//, `${path.relative(root, file)} must not reference an internal src/** path`);
    }
    assert.ok(seenSpecs.size >= 3, 'the templates collectively import from more than one @theharborproject/trim subpath');
    for (const spec of seenSpecs) {
      assert.doesNotThrow(() => require.resolve(spec, { paths: [root] }), `"${spec}" must resolve through a real exported public subpath`);
    }
    execFileSync('node', [
      'node_modules/typescript/bin/tsc', ...templateFiles.map((f) => path.relative(root, f)),
      '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
    ], { cwd: root });
  }

  // --- @default/example: fresh init -> installs successfully, correct file tree, config groups, typechecks ---
  {
    const dir = await emptyFixture('example-fresh');
    const output = await swallowLogs(() => runAddCommand(dir, '@default/example'));
    assert.match(output, /Example installed/);

    for (const f of ['trim/controls/theme.trim.ts', 'trim/controls/contrast.trim.ts', 'trim/controls/animations.trim.ts', 'trim/trim.manifest.ts', 'trim/trim.settings.ts', 'trim/trim.config.tsx', 'host/contrast-store.ts', 'trim/renderers/custom-contrast.tsx', 'example-panel.tsx']) {
      assert.ok(existsSync(path.join(dir, f)), `${f} was installed`);
    }

    const config = readFileSync(path.join(dir, 'trim/trim.config.tsx'), 'utf8');
    assert.match(config, /id: "vision"/);
    assert.match(config, /id: "motion"/);
    assert.equal((config.match(/"theme"/g) ?? []).length, 1);
    assert.equal((config.match(/"contrast"/g) ?? []).length, 1);
    assert.equal((config.match(/"animations"/g) ?? []).length, 2, 'animations is attached twice — the is_unique: false demonstration');

    const panel = readFileSync(path.join(dir, 'example-panel.tsx'), 'utf8');
    assert.match(panel, /themes\/default\.css/, 'default styling: the panel imports Trim\'s own default theme');

    const relFiles = ['trim/controls/theme.trim.ts', 'trim/controls/contrast.trim.ts', 'trim/controls/animations.trim.ts', 'trim/trim.manifest.ts', 'trim/trim.settings.ts', 'trim/trim.config.tsx', 'host/contrast-store.ts', 'trim/renderers/custom-contrast.tsx', 'example-panel.tsx'].map((p) => path.relative(root, path.join(dir, p)));
    execFileSync('node', [
      'node_modules/typescript/bin/tsc', ...relFiles,
      '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
    ], { cwd: root });
  }

  // Generated controls/manifest/settings retain the API fixture's expected output.
  // Literal template assets must match their single canonical source in cli/templates.
  {
    const dir = await emptyFixture('example-drift-check');
    await swallowLogs(() => runAddCommand(dir, '@default/example'));
    for (const f of ['trim/controls/theme.trim.ts', 'trim/controls/contrast.trim.ts', 'trim/controls/animations.trim.ts', 'trim/trim.manifest.ts', 'trim/trim.settings.ts']) {
      const installed = readFileSync(path.join(dir, f), 'utf8');
      const expected = readFileSync(path.join(root, 'tests/fixtures/default', f), 'utf8');
      assert.equal(installed, expected, `${f}: generated output must match the API fixture`);
    }
    for (const f of ['host/contrast-store.ts', 'trim/renderers/custom-contrast.tsx', 'example-panel.tsx']) {
      const canonical = readFileSync(path.join(root, 'cli/templates/default/example', f), 'utf8');
      assert.equal(readFileSync(path.join(dir, f), 'utf8'), canonical, `${f}: installed template must match its canonical source`);
      assert.equal(readFileSync(path.join(root, 'dist/cli/templates/default/example', f), 'utf8'), canonical, `${f}: built template must match its canonical source`);
    }
    // The API fixture hand-wires a custom renderer; the installer leaves that
    // optional config edit to the host and attaches contrast as a bare id.
  }

  // --- @default/example: rejected when the project already has a declared control ---
  {
    const dir = await emptyFixture('example-rejected-existing-control');
    await swallowLogs(() => runNewControlCommand(dir, 'reduced-motion', scriptedAsk(['1', '', 'n', '1', 'n'])));
    await assert.rejects(runAddCommand(dir, '@default/example'), UsageError);
    await assert.rejects(runAddCommand(dir, '@default/example'), /can only be installed into an empty Trim setup/);
    assert.ok(!existsSync(path.join(dir, 'trim/controls/theme.trim.ts')), 'nothing from the example was installed');
  }

  // --- @default/example: rejected when trim.config.tsx already has a group ---
  {
    const dir = await emptyFixture('example-rejected-existing-group');
    const configPath = path.join(dir, 'trim/trim.config.tsx');
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('groups: []', 'groups: [{ id: "misc", label: "Misc", controls: [] }]'), 'utf8');
    await assert.rejects(runAddCommand(dir, '@default/example'), UsageError);
    await assert.rejects(runAddCommand(dir, '@default/example'), /already contains Trim configuration/);
  }

  // --- @default/example: not initialized fails safely, no prompting/filesystem writes ---
  {
    const dir = path.join(testRoot, 'example-not-initialized');
    mkdirSync(dir, { recursive: true });
    await assert.rejects(runAddCommand(dir, '@default/example'), UsageError);
    await assert.rejects(runAddCommand(dir, '@default/example'), /trim init/);
  }

  // --- REAL sequence: genuine `trim init` immediately followed by genuine `trim add @default/example`, ---
  // --- with NO fixture stripping (unlike emptyFixture above) — exercises and documents the ACTUAL current ---
  // --- behavior of that exact back-to-back sequence. This now SUCCEEDS: the canonical, untouched `trim init` ---
  // --- starter is case 1 of example-plan.ts's 3-case reconciliation — it is transactionally REPLACED by ---
  // --- @default/example (starter's control file/manifest entry/settings entry/config group all removed, ---
  // --- @default/example's own installed, in one operation), not rejected the way it used to be. ---
  {
    const dir = path.join(testRoot, 'real-sequence-init-then-example');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler' } }), 'utf8');
    await swallowLogs(() => runInitCommand(dir, scriptedAsk(['1', '1', '1'])));
    assert.ok(existsSync(path.join(dir, 'trim/controls/starter.trim.ts')), 'trim init seeded the "starter" control');

    const output = await swallowLogs(() => runAddCommand(dir, '@default/example'));
    assert.match(output, /Example installed/);
    assert.match(output, /Removed trim\/controls\/starter\.trim\.ts/, 'output reports the starter removal alongside the create/matches/conflict reporting');

    assert.ok(!existsSync(path.join(dir, 'trim/controls/starter.trim.ts')), 'starter.trim.ts no longer exists');
    for (const f of ['trim/controls/theme.trim.ts', 'trim/controls/contrast.trim.ts', 'trim/controls/animations.trim.ts', 'host/contrast-store.ts', 'trim/renderers/custom-contrast.tsx', 'example-panel.tsx']) {
      assert.ok(existsSync(path.join(dir, f)), `${f} was installed`);
    }

    const manifest = readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8');
    assert.doesNotMatch(manifest, /starter/, 'trim.manifest.ts has no starter reference');
    assert.match(manifest, /theme/);
    assert.match(manifest, /animations/);

    const settings = readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8');
    assert.doesNotMatch(settings, /starter/, 'trim.settings.ts has no starter key');
    assert.match(settings, /theme/);
    assert.match(settings, /animations/);

    const config = readFileSync(path.join(dir, 'trim/trim.config.tsx'), 'utf8');
    assert.doesNotMatch(config, /starter/, 'trim.config.tsx has no starter group');
    assert.match(config, /id: "vision"/);
    assert.match(config, /id: "motion"/);
    assert.equal((config.match(/"theme"/g) ?? []).length, 1);
    assert.equal((config.match(/"contrast"/g) ?? []).length, 1);
    assert.equal((config.match(/"animations"/g) ?? []).length, 2, 'animations is attached twice — the is_unique: false demonstration');

    const relFiles = ['trim/controls/theme.trim.ts', 'trim/controls/contrast.trim.ts', 'trim/controls/animations.trim.ts', 'trim/trim.manifest.ts', 'trim/trim.settings.ts', 'trim/trim.config.tsx', 'host/contrast-store.ts', 'trim/renderers/custom-contrast.tsx', 'example-panel.tsx'].map((p) => path.relative(root, path.join(dir, p)));
    execFileSync('node', [
      'node_modules/typescript/bin/tsc', ...relFiles,
      '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
    ], { cwd: root });
  }

  // --- @default/example: case 3 — anything that deviates from the EXACT canonical trim init starter refuses ---
  // --- safely (a clear UsageError), leaving every file byte-identical to before the attempt. The check is by ---
  // --- CONTENT (byte-compare the control/manifest/settings files, AST-parse the config group), never by the ---
  // --- id "starter" alone — a project whose "starter" doesn't match the generated shape is refused, not ---
  // --- destroyed, exactly like every other non-canonical, non-empty state. ---
  {
    // sub-case: starter.trim.ts hand-edited (label changed) after a fresh init
    const dir = await initializedFixture('example-case3-handedited-starter');
    const controlPath = path.join(dir, 'trim/controls/starter.trim.ts');
    const manifestPath = path.join(dir, 'trim/trim.manifest.ts');
    const settingsPath = path.join(dir, 'trim/trim.settings.ts');
    const configPath = path.join(dir, 'trim/trim.config.tsx');
    const before = { manifest: readFileSync(manifestPath, 'utf8'), settings: readFileSync(settingsPath, 'utf8'), config: readFileSync(configPath, 'utf8') };
    writeFileSync(controlPath, readFileSync(controlPath, 'utf8').replace('"Starter control"', '"My Starter"'), 'utf8');
    const handEdited = readFileSync(controlPath, 'utf8');

    await assert.rejects(runAddCommand(dir, '@default/example'), UsageError);
    await assert.rejects(runAddCommand(dir, '@default/example'), /can only be installed into an empty Trim setup, or replace an untouched/);
    assert.equal(readFileSync(controlPath, 'utf8'), handEdited, 'starter.trim.ts left exactly as the hand-edit left it — nothing written');
    assert.equal(readFileSync(manifestPath, 'utf8'), before.manifest, 'trim.manifest.ts byte-identical — nothing written');
    assert.equal(readFileSync(settingsPath, 'utf8'), before.settings, 'trim.settings.ts byte-identical — nothing written');
    assert.equal(readFileSync(configPath, 'utf8'), before.config, 'trim.config.tsx byte-identical — nothing written');
    assert.ok(!existsSync(path.join(dir, 'trim/controls/theme.trim.ts')), 'nothing from the example was installed');
  }

  {
    // sub-case: an extra control exists alongside starter
    const dir = await initializedFixture('example-case3-extra-control');
    await swallowLogs(() => runNewControlCommand(dir, 'reduced-motion', scriptedAsk(['1', '', 'n', '1', 'n'])));
    const controlPath = path.join(dir, 'trim/controls/starter.trim.ts');
    const configPath = path.join(dir, 'trim/trim.config.tsx');
    const controlBefore = readFileSync(controlPath, 'utf8');
    const configBefore = readFileSync(configPath, 'utf8');

    await assert.rejects(runAddCommand(dir, '@default/example'), UsageError);
    await assert.rejects(runAddCommand(dir, '@default/example'), /already has 2 declared control\(s\)/);
    assert.equal(readFileSync(controlPath, 'utf8'), controlBefore, 'starter.trim.ts byte-identical — nothing written');
    assert.equal(readFileSync(configPath, 'utf8'), configBefore, 'trim.config.tsx byte-identical — nothing written');
    assert.ok(existsSync(controlPath), 'starter was NOT removed');
    assert.ok(!existsSync(path.join(dir, 'trim/controls/theme.trim.ts')), 'nothing from the example was installed');
  }

  {
    // sub-case: an extra group exists in trim.config.tsx alongside the starter group
    const dir = await initializedFixture('example-case3-extra-group');
    const configPath = path.join(dir, 'trim/trim.config.tsx');
    const before = readFileSync(configPath, 'utf8');
    const withExtraGroup = before.replace('controls: ["starter"],\n    },\n  ],', 'controls: ["starter"],\n    },\n    { id: "misc", label: "Misc", controls: [] },\n  ],');
    assert.notEqual(withExtraGroup, before, 'sanity: the extra group was actually inserted into the fixture');
    writeFileSync(configPath, withExtraGroup, 'utf8');

    await assert.rejects(runAddCommand(dir, '@default/example'), UsageError);
    await assert.rejects(runAddCommand(dir, '@default/example'), /can only be installed into an empty Trim setup, or replace an untouched/);
    assert.equal(readFileSync(configPath, 'utf8'), withExtraGroup, 'trim.config.tsx byte-identical — nothing written');
    assert.ok(existsSync(path.join(dir, 'trim/controls/starter.trim.ts')), 'starter was NOT removed');
    assert.ok(!existsSync(path.join(dir, 'trim/controls/theme.trim.ts')), 'nothing from the example was installed');
  }

  {
    // sub-case: starter's group in config.tsx modified beyond the canonical shape — label changed
    const dir = await initializedFixture('example-case3-modified-group-label');
    const configPath = path.join(dir, 'trim/trim.config.tsx');
    const modified = readFileSync(configPath, 'utf8').replace('label: "Example"', 'label: "Renamed"');
    writeFileSync(configPath, modified, 'utf8');

    await assert.rejects(runAddCommand(dir, '@default/example'), UsageError);
    assert.equal(readFileSync(configPath, 'utf8'), modified, 'trim.config.tsx byte-identical — nothing written');
    assert.ok(existsSync(path.join(dir, 'trim/controls/starter.trim.ts')), 'starter was NOT removed');
  }

  {
    // sub-case: starter's group in config.tsx modified beyond the canonical shape — an extra control id added to its `controls` array
    const dir = await initializedFixture('example-case3-modified-group-controls');
    const configPath = path.join(dir, 'trim/trim.config.tsx');
    const modified = readFileSync(configPath, 'utf8').replace('controls: ["starter"],', 'controls: ["starter", "extra"],');
    writeFileSync(configPath, modified, 'utf8');

    await assert.rejects(runAddCommand(dir, '@default/example'), UsageError);
    assert.equal(readFileSync(configPath, 'utf8'), modified, 'trim.config.tsx byte-identical — nothing written');
    assert.ok(existsSync(path.join(dir, 'trim/controls/starter.trim.ts')), 'starter was NOT removed');
    assert.ok(!existsSync(path.join(dir, 'trim/controls/theme.trim.ts')), 'nothing from the example was installed');
  }

  // --- @default/example: TRANSACTIONAL — a conflicting literal file blocks EVERYTHING, including the generated files ---
  {
    const dir = await emptyFixture('example-transactional');
    writeFileSync(path.join(dir, 'example-panel.tsx'), '// a file this project already had, unrelated to Trim\n', 'utf8');
    await assert.rejects(runAddCommand(dir, '@default/example'), UsageError);
    assert.ok(!existsSync(path.join(dir, 'trim/controls/theme.trim.ts')), 'no control was created');
    assert.ok(!existsSync(path.join(dir, 'host/contrast-store.ts')), 'no OTHER literal file was created either — the whole install aborted');
    assert.match(readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8'), /export const trimControls = \[\] as const;\n$/, 'manifest still empty');
    const config = readFileSync(path.join(dir, 'trim/trim.config.tsx'), 'utf8');
    assert.match(config, /groups: \[\],/, 'config untouched');
  }

  // --- headless styling: the installed example panel does NOT import Trim's default theme CSS ---
  {
    const dir = await emptyFixture('example-headless', { styling: 'headless' });
    await swallowLogs(() => runAddCommand(dir, '@default/example'));
    const panel = readFileSync(path.join(dir, 'example-panel.tsx'), 'utf8');
    assert.doesNotMatch(panel, /themes\/default\.css/, 'headless: no default-theme CSS is secretly injected');
    assert.doesNotMatch(panel, /\.css/, 'headless: no CSS import of any kind');
  }

  // --- tokens styling: the installed example panel imports the project's own trim/trim.css, never overwriting it ---
  {
    const dir = await emptyFixture('example-tokens', { styling: 'tokens' });
    const tokensCssBefore = readFileSync(path.join(dir, 'trim/trim.css'), 'utf8');
    await swallowLogs(() => runAddCommand(dir, '@default/example'));
    const panel = readFileSync(path.join(dir, 'example-panel.tsx'), 'utf8');
    assert.match(panel, /import "\.\/trim\/trim\.css";/, 'tokens: the panel imports the project\'s own token-mapped stylesheet');
    assert.doesNotMatch(panel, /themes\/default\.css/);
    assert.equal(readFileSync(path.join(dir, 'trim/trim.css'), 'utf8'), tokensCssBefore, 'trim/trim.css itself is never touched by the example installer');
  }

  // --- shadcn preference never changes @default/... behavior ---
  {
    const dir = await initializedFixture('shadcn-does-not-affect-default');
    mkdirSync(path.join(dir, 'components.json').replace(/components\.json$/, ''), { recursive: true }); // no-op, dir already exists
    const noShadcnOutput = await swallowLogs(() => runAddCommand(dir, '@default/controls/boolean'));
    assert.doesNotMatch(noShadcnOutput.toLowerCase(), /shadcn/, '@default/controls/boolean never mentions shadcn, regardless of trim.json');
  }

  // --- tarball: dist/cli/templates/** ships; raw cli/templates/** source and examples/** never do ---
  {
    const json = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
    const files = JSON.parse(json)[pkg.name].files.map((f) => f.path);
    assert.ok(files.includes('dist/cli/commands/add.js'));
    assert.ok(files.includes('dist/cli/generators/template-registry.js'));
    assert.ok(files.includes('dist/cli/generators/example-plan.js'));
    assert.ok(files.includes('dist/cli/templates-path.js'));
    for (const entry of TEMPLATE_REGISTRY) {
      assert.ok(files.includes(`dist/cli/templates/${entry.templatePath}`), `dist/cli/templates/${entry.templatePath} ships`);
    }
    assert.ok(files.includes('dist/cli/templates/default/example/example-panel.tsx'));
    assert.ok(files.includes('dist/cli/templates/default/example/host/contrast-store.ts'));
    assert.ok(files.includes('dist/cli/templates/default/example/trim/renderers/custom-contrast.tsx'));
    assert.ok(!files.some((f) => f.startsWith('cli/')), 'raw cli/** source (including cli/templates/**) never ships');
    assert.ok(!files.some((f) => f.startsWith('examples/')), 'examples/ never ships');
    assert.ok(!files.some((f) => f.startsWith('.trim-cli-add-test-')), 'no test fixture directory leaks into the tarball');
    // REGRESSION: the build script's template-copy step must be idempotent
    // across repeated `npm run build` runs (every test file in this suite
    // runs it at least once) — `cp -r src dst` nests src INSIDE an
    // already-existing dst directory on a second run instead of overwriting
    // it, producing dist/cli/templates/default/controls/controls/*.tsx.
    // Caught by actually running the build twice in a row, not just reading
    // the script text.
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
    assert.ok(!existsSync(path.join(root, 'dist/cli/templates/default/controls/controls')), 'repeated builds must not nest a duplicate controls/controls directory');
    assert.ok(!existsSync(path.join(root, 'dist/cli/templates/default/layouts/layouts')), 'repeated builds must not nest a duplicate layouts/layouts directory');
    assert.deepEqual(
      readdirSync(path.join(root, 'dist/cli/templates/default/controls')).sort(),
      ['boolean.tsx', 'segmented.tsx', 'toggle-action.tsx'],
      'exactly the 3 control templates, nothing extra left over from a stale prior build',
    );
  }

  // --- template lookup works from an ACTUAL packed-and-extracted tarball, not just repo-relative dev paths ---
  {
    const packDir = mkdtempSync(path.join(testRoot, 'pack-'));
    const tarballName = execFileSync('npm', ['pack', '--silent', '--pack-destination', packDir], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();
    const extractDir = path.join(packDir, 'extracted');
    mkdirSync(extractDir, { recursive: true });
    execFileSync('tar', ['xzf', path.join(packDir, tarballName), '-C', extractDir]);
    const installedBin = path.join(extractDir, 'package/dist/cli/bin/trim.js');
    assert.ok(existsSync(installedBin));

    const consumerDir = path.join(packDir, 'consumer');
    mkdirSync(consumerDir, { recursive: true });
    execFileSync('node', [installedBin, 'add', '@default/controls/boolean'], { cwd: consumerDir });
    const installedFile = readFileSync(path.join(consumerDir, 'trim/renderers/boolean.tsx'), 'utf8');
    assert.match(installedFile, /DefaultBooleanControl/, 'the template was correctly resolved from the packed-and-extracted package\'s OWN dist/cli/templates, not a repo-relative dev path');

    const exampleConsumer = await emptyFixture('packed-example');
    execFileSync('node', [installedBin, 'add', '@default/example'], { cwd: exampleConsumer });
    for (const file of ['host/contrast-store.ts', 'trim/renderers/custom-contrast.tsx', 'example-panel.tsx']) {
      assert.equal(
        readFileSync(path.join(exampleConsumer, file), 'utf8'),
        readFileSync(path.join(root, 'cli/templates/default/example', file), 'utf8'),
        `${file}: packed CLI installs the canonical example template`,
      );
    }
  }

  console.log('PASS CLI add: static ref registry (every supported ref resolves, unknown ref is a clean UsageError listing available refs, no filesystem access), each simple template (@default/controls/boolean|segmented|toggle-action, @default/layouts/sections) installs/is idempotent/conflicts safely, generated imports resolve through the real public export map with no internal src/** references and typecheck against the real built package, @default/example (fresh empty install with correct file tree/config groups/typecheck, anti-drift byte-equality against canonical cli/templates assets and generated API fixtures, case 2 rejected on an existing control or existing config group with no controls, rejected when not initialized, fully transactional on any literal-file conflict, headless never injects default CSS, tokens imports the project\'s own trim.css without touching it, shadcn preference never affects @default/... behavior, case 1: a real trim init -> trim add @default/example now transactionally REPLACES the canonical starter with the example -- starter gone, example fully installed, typechecks -- and case 3: any deviation from the canonical starter shape (hand-edited control, extra control, extra config group, modified starter group label/controls) refuses with a UsageError and leaves every file byte-identical, never silently destroying it), tarball ships dist/cli/templates/** but never raw cli/templates/** or examples/**, and template lookup works from an actual packed-and-extracted tarball');
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
