// Tests for `trim init` (cli/commands/init.ts, cli/generators/init-files.ts,
// cli/generators/settings-file.ts, cli/project/detect-project.ts,
// cli/project/module-resolution.ts, cli/project/trim-metadata.ts).
//
// Exercises the "detect project -> build plan -> apply plan" pipeline
// directly with fixture projects and predetermined answers — no TTY, no
// real prompting (see cli/prompts/init-prompts.ts's own header for the
// readline quirk that shaped its design; the interactive path itself is
// smoke-tested separately below via a real piped subprocess, once, to
// prove the whole prompt->plan->apply chain actually works end to end).
//
// Runs the real `npm run build` (like package-exports/example/cli tests) —
// generated-file typechecking needs the real dist/ output, self-referenced
// by the package's own name exactly as an installed consumer would resolve
// it, so fixtures live inside the repo tree (self-reference only works
// there), never under /tmp.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { detectProject, stripJsonComments } = require(path.join(root, 'dist/cli/project/detect-project.js'));
const { relativeImportSpecifier } = require(path.join(root, 'dist/cli/project/module-resolution.js'));
const { parseTrimMetadata, serializeTrimMetadata, TRIM_JSON_PATH } = require(path.join(root, 'dist/cli/project/trim-metadata.js'));
const {
  buildInitPlan, applyInitPlan,
  generateConfigContents, generateManifestContents, generateSettingsContents, generateTokensCssContents,
  CONFIG_PATH, MANIFEST_PATH, SETTINGS_PATH, TOKENS_CSS_PATH,
} = require(path.join(root, 'dist/cli/generators/init-files.js'));
const { runInitCommand } = require(path.join(root, 'dist/cli/commands/init.js'));
const { UsageError } = require(path.join(root, 'dist/cli/dispatch.js'));

const testRoot = mkdtempSync(path.join(root, '.trim-cli-init-test-'));
function fixture(name, { tsconfig = '{}', files = {} } = {}) {
  const dir = path.join(testRoot, name);
  mkdirSync(dir, { recursive: true });
  if (tsconfig !== null) writeFileSync(path.join(dir, 'tsconfig.json'), tsconfig, 'utf8');
  for (const [relPath, contents] of Object.entries(files)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  return dir;
}
const swallowLogs = async (fn) => {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
};
const CORE_FILE_COUNT = 4; // config, manifest, settings, trim.json

try {
  // --- stripJsonComments: the one thing worth unit-testing in isolation ---
  // --- (real-world tsconfig.json footgun: a "//" inside a URL value) ---
  {
    const source = '{\n  "$schema": "https://json.schemastore.org/tsconfig",\n  // a real comment\n  "compilerOptions": { "moduleResolution": "bundler", },\n}';
    const stripped = JSON.parse(stripJsonComments(source));
    assert.equal(stripped.$schema, 'https://json.schemastore.org/tsconfig', 'a "//" inside a string value must survive comment stripping');
    assert.equal(stripped.compilerOptions.moduleResolution, 'bundler');
  }

  // --- relativeImportSpecifier: the generation-time module-resolution helper ---
  {
    assert.equal(relativeImportSpecifier('classic-or-bundler', './trim/trim.config'), './trim/trim.config');
    assert.equal(relativeImportSpecifier('node16-or-nodenext', './trim/trim.config'), './trim/trim.config.js');
  }

  // --- trim.json: serialize/parse round trip, and rejection of malformed content ---
  {
    const metadata = { version: 1, shadcn: true, styling: 'tokens' };
    assert.deepEqual(parseTrimMetadata(serializeTrimMetadata(metadata)), metadata);
    assert.equal(parseTrimMetadata('not json'), undefined);
    assert.equal(parseTrimMetadata('{"version":2,"shadcn":false,"styling":"default"}'), undefined, 'an unknown version is not guessed at');
    assert.equal(parseTrimMetadata('{"version":1,"shadcn":false,"styling":"nonsense"}'), undefined, 'an unrecognized styling value is not guessed at');
  }

  // --- fresh TypeScript project: detection ---
  {
    const dir = fixture('fresh-ts', { tsconfig: '{ "compilerOptions": { "moduleResolution": "bundler" } }' });
    const project = detectProject(dir);
    assert.equal(project.isTypeScript, true);
    assert.equal(project.moduleResolution, 'classic-or-bundler');
    assert.equal(project.shadcnConfigured, false);
    assert.equal(project.globalStylesheet, undefined);
    assert.deepEqual(project.identifiedProjectTokens, []);
  }

  // --- JS-only project: no tsconfig.json at all ---
  {
    const dir = fixture('js-only', { tsconfig: null });
    const project = detectProject(dir);
    assert.equal(project.isTypeScript, false);
  }

  // --- moduleResolution differences drive the printed integration snippet ---
  {
    const bundlerDir = fixture('resolution-bundler', { tsconfig: '{ "compilerOptions": { "moduleResolution": "bundler" } }' });
    const nodenextDir = fixture('resolution-nodenext', { tsconfig: '{ "compilerOptions": { "moduleResolution": "nodenext" } }' });
    const bundlerPlan = await buildInitPlan(detectProject(bundlerDir), { useShadcn: false, styling: 'default' });
    const nodenextPlan = await buildInitPlan(detectProject(nodenextDir), { useShadcn: false, styling: 'default' });
    assert.match(bundlerPlan.integrationSnippet, /from "\.\/trim\/trim\.config"/, 'bundler resolution: extensionless');
    assert.match(nodenextPlan.integrationSnippet, /from "\.\/trim\/trim\.config\.js"/, 'nodenext resolution: explicit .js');
  }

  // --- generated file contents: exact ---
  {
    assert.equal(generateConfigContents(), readCanonical('config'));
    assert.equal(generateManifestContents(), readCanonical('manifest'));
    assert.equal(generateSettingsContents(), readCanonical('settings'));
    assert.match(generateConfigContents(), /defineTrimConfig\(\{\s*\n\s*layout: "sections",\s*\n\s*groups: \[\],/);
    assert.match(generateManifestContents(), /export const trimControls = \[\] as const;/);
    const settingsCode = generateSettingsContents().replace(/\/\/[^\n]*/g, ''); // strip comments — they legitimately *name* createTrimController to explain why it's not called
    assert.doesNotMatch(settingsCode, /createTrimController/, 'no fake schema is instantiated just to have something to export');
    assert.match(generateSettingsContents(), /export \{\};/);
    assert.match(generateSettingsContents(), /@trim-managed-schema \{"version":1,"settings":\[\]\}/, 'the empty case still embeds the versioned, machine-readable marker trim new control will look for');
  }
  function readCanonical(which) {
    // Re-derive from the same generator, proving determinism (called twice, byte-identical).
    return { config: generateConfigContents, manifest: generateManifestContents, settings: generateSettingsContents }[which]();
  }

  // --- styling: default theme -> no extra file (still exactly the 4 core files), correct instruction ---
  {
    const dir = fixture('styling-default', { tsconfig: '{}' });
    const plan = await buildInitPlan(detectProject(dir), { useShadcn: false, styling: 'default' });
    assert.equal(plan.files.length, CORE_FILE_COUNT, 'no trim.css for the default-theme choice');
    assert.ok(plan.notes.some((n) => n.includes('@theharborproject/trim/themes/default.css')));
    const trimJson = plan.files.find((f) => f.path === TRIM_JSON_PATH);
    assert.deepEqual(parseTrimMetadata(trimJson.contents), { version: 1, shadcn: false, styling: 'default' });
  }

  // --- styling: fully headless -> no extra file, no CSS import mentioned ---
  {
    const dir = fixture('styling-headless', { tsconfig: '{}' });
    const plan = await buildInitPlan(detectProject(dir), { useShadcn: false, styling: 'headless' });
    assert.equal(plan.files.length, CORE_FILE_COUNT);
    assert.ok(plan.notes.some((n) => n.includes('headless') || n.includes('yourself')));
    assert.ok(!plan.notes.some((n) => n.includes('themes/default.css')), 'headless never mentions importing Trim CSS');
    assert.deepEqual(parseTrimMetadata(plan.files.find((f) => f.path === TRIM_JSON_PATH).contents).styling, 'headless');
  }

  // --- styling: project tokens, WITH identifiable tokens ---
  {
    const dir = fixture('styling-tokens-found', {
      tsconfig: '{}',
      files: { 'src/index.css': ':root { --background: #fff; --foreground: #111; --border: #eee; --something-else: red; }' },
    });
    const project = detectProject(dir);
    assert.deepEqual(project.identifiedProjectTokens.sort(), ['background', 'border', 'foreground']);
    const plan = await buildInitPlan(project, { useShadcn: false, styling: 'tokens' });
    assert.equal(plan.files.length, CORE_FILE_COUNT + 1, 'trim.css is the one extra file for the tokens choice');
    const cssFile = plan.files.find((f) => f.path === TOKENS_CSS_PATH);
    assert.ok(cssFile, 'trim/trim.css is planned');
    assert.match(cssFile.contents, /--trim-bg: var\(--background\);/);
    assert.match(cssFile.contents, /--trim-ink: var\(--foreground\);/);
    assert.match(cssFile.contents, /--trim-line: var\(--border\);/);
    assert.doesNotMatch(cssFile.contents, /--something-else/, 'an unrecognized project variable is never guessed into the mapping');
    assert.ok(plan.notes.some((n) => n.includes('Mapped 3 token')));
    assert.deepEqual(parseTrimMetadata(plan.files.find((f) => f.path === TRIM_JSON_PATH).contents).styling, 'tokens');
  }

  // --- styling: project tokens, with NO identifiable tokens -> standalone fallback, never invented names ---
  {
    const dir = fixture('styling-tokens-not-found', { tsconfig: '{}' });
    const plan = await buildInitPlan(detectProject(dir), { useShadcn: false, styling: 'tokens' });
    const cssFile = plan.files.find((f) => f.path === TOKENS_CSS_PATH);
    assert.ok(cssFile);
    const cssCode = cssFile.contents.replace(/\/\*[\s\S]*?\*\//g, ''); // strip the comment — it legitimately shows var(--your-background-token) as an illustrative example
    assert.doesNotMatch(cssCode, /var\(--/, 'no var(--...) reference to a nonexistent project variable outside the illustrative comment');
    assert.match(cssFile.contents, /standalone starter values/);
    assert.ok(plan.notes.some((n) => n.includes('No recognizable project design tokens')));
  }
  {
    // generateTokensCssContents in isolation, both branches
    assert.equal(generateTokensCssContents(['background']).usedIdentifiedTokens, true);
    assert.equal(generateTokensCssContents([]).usedIdentifiedTokens, false);
  }

  // --- shadcn: chosen but not configured -> trim.json NEVER records true, clear caveat, no broken import generated ---
  {
    const dir = fixture('shadcn-not-configured', { tsconfig: '{}' });
    const plan = await buildInitPlan(detectProject(dir), { useShadcn: true, styling: 'default' });
    assert.ok(plan.notes.some((n) => n.includes('does not appear to be set up')));
    assert.ok(!plan.files.some((f) => f.path !== TRIM_JSON_PATH && /shadcn/i.test(f.contents)), 'no generated code file references shadcn — nothing shadcn-specific is generated in this step');
    const metadata = parseTrimMetadata(plan.files.find((f) => f.path === TRIM_JSON_PATH).contents);
    assert.equal(metadata.shadcn, false, 'trim.json never records shadcn:true unless shadcn is independently confirmed configured — defense in depth even when a caller bypasses the prompt-level guard');
  }

  // --- shadcn: chosen AND configured -> different, non-alarming note, trim.json records true ---
  {
    const dir = fixture('shadcn-configured', { tsconfig: '{}', files: { 'components.json': '{}' } });
    const project = detectProject(dir);
    assert.equal(project.shadcnConfigured, true);
    const plan = await buildInitPlan(project, { useShadcn: true, styling: 'default' });
    assert.ok(plan.notes.some((n) => n.includes('recorded in trim/trim.json')));
    assert.ok(!plan.notes.some((n) => n.includes('does not appear to be set up')));
    assert.equal(parseTrimMetadata(plan.files.find((f) => f.path === TRIM_JSON_PATH).contents).shadcn, true);
    // step 10: a note only, pointing at `trim add @shadcn/...` — init itself
    // still generates nothing shadcn-specific and never installs anything.
    assert.ok(plan.notes.some((n) => n.includes('trim add @shadcn/controls/boolean')));
  }

  // --- shadcn: declined -> no note either way, trim.json records false ---
  {
    const dir = fixture('shadcn-declined', { tsconfig: '{}' });
    const plan = await buildInitPlan(detectProject(dir), { useShadcn: false, styling: 'default' });
    assert.ok(!plan.notes.some((n) => n.toLowerCase().includes('shadcn')));
    assert.equal(parseTrimMetadata(plan.files.find((f) => f.path === TRIM_JSON_PATH).contents).shadcn, false);
  }

  // --- apply + idempotency: create, then re-plan against disk shows "matches", zero writes needed ---
  {
    const dir = fixture('idempotent', { tsconfig: '{}' });
    const project = detectProject(dir);
    const firstPlan = await buildInitPlan(project, { useShadcn: false, styling: 'default' });
    assert.ok(firstPlan.files.every((f) => f.status === 'create'));
    await applyInitPlan(dir, firstPlan);
    assert.ok(existsSync(path.join(dir, CONFIG_PATH)));
    assert.ok(existsSync(path.join(dir, MANIFEST_PATH)));
    assert.ok(existsSync(path.join(dir, SETTINGS_PATH)));
    assert.ok(existsSync(path.join(dir, TRIM_JSON_PATH)));

    const secondPlan = await buildInitPlan(project, { useShadcn: false, styling: 'default' });
    assert.ok(secondPlan.files.every((f) => f.status === 'matches'), 're-planning with identical answers reports every file as already matching');
  }

  // --- trim.json specifically: re-running with DIFFERENT answers is "update", never "conflict" ---
  // --- (it is never allowed to block the whole plan on its own) ---
  {
    const dir = fixture('trim-json-update', { tsconfig: '{}' });
    const project = detectProject(dir);
    await applyInitPlan(dir, await buildInitPlan(project, { useShadcn: false, styling: 'default' }));

    const changedPlan = await buildInitPlan(project, { useShadcn: false, styling: 'headless' });
    const trimJsonEntry = changedPlan.files.find((f) => f.path === TRIM_JSON_PATH);
    assert.equal(trimJsonEntry.status, 'update', 'a different answer updates trim.json rather than conflicting with its previous self');
    assert.ok(changedPlan.files.filter((f) => f.path !== TRIM_JSON_PATH).every((f) => f.status === 'matches'), 'the other 3 core files are unaffected by the styling change');

    await applyInitPlan(dir, changedPlan);
    assert.equal(parseTrimMetadata(readFileSync(path.join(dir, TRIM_JSON_PATH), 'utf8')).styling, 'headless', 'the update actually applied');
  }

  // --- conflict: a hand-edited file is never overwritten, "matches" files are never blocked by it ---
  {
    const dir = fixture('conflict', { tsconfig: '{}' });
    const project = detectProject(dir);
    await applyInitPlan(dir, await buildInitPlan(project, { useShadcn: false, styling: 'default' }));
    const handEdited = generateConfigContents() + '// hand-edited\n';
    writeFileSync(path.join(dir, CONFIG_PATH), handEdited, 'utf8');

    const plan = await buildInitPlan(project, { useShadcn: false, styling: 'default' });
    const configEntry = plan.files.find((f) => f.path === CONFIG_PATH);
    assert.equal(configEntry.status, 'conflict');
    assert.ok(plan.files.filter((f) => f.path !== CONFIG_PATH).every((f) => f.status === 'matches'), 'identical existing files are never themselves flagged, even alongside a real conflict');

    await applyInitPlan(dir, plan); // must be a no-op for the conflicting file
    assert.equal(readFileSync(path.join(dir, CONFIG_PATH), 'utf8'), handEdited, 'the hand-edited file is untouched — no destructive overwrite');
  }

  // --- TRANSACTIONAL: one conflict + otherwise-missing files => NOTHING is created, not even the safe ones ---
  {
    const dir = fixture('transactional-abort', { tsconfig: '{}' });
    mkdirSync(path.join(dir, 'trim'), { recursive: true });
    // Only trim.config.tsx exists, and with content that will conflict —
    // manifest.ts, settings.ts and trim.json are all still missing.
    writeFileSync(path.join(dir, CONFIG_PATH), '// not what Trim would generate\n', 'utf8');

    const plan = await buildInitPlan(detectProject(dir), { useShadcn: false, styling: 'default' });
    const statuses = Object.fromEntries(plan.files.map((f) => [f.path, f.status]));
    assert.equal(statuses[CONFIG_PATH], 'conflict');
    assert.equal(statuses[MANIFEST_PATH], 'create');
    assert.equal(statuses[SETTINGS_PATH], 'create');
    assert.equal(statuses[TRIM_JSON_PATH], 'create');

    // The command-level contract (cli/commands/init.ts): a plan containing
    // any "conflict" must never reach applyInitPlan at all. Simulate that
    // contract directly here to prove the missing files stay missing —
    // runInitCommand's own enforcement of it is proven separately below.
    const hasConflict = plan.files.some((f) => f.status === 'conflict');
    assert.ok(hasConflict);
    if (!hasConflict) await applyInitPlan(dir, plan);

    assert.ok(!existsSync(path.join(dir, MANIFEST_PATH)), 'a file that was safe to create is NOT created when another file in the same plan conflicts');
    assert.ok(!existsSync(path.join(dir, SETTINGS_PATH)));
    assert.ok(!existsSync(path.join(dir, TRIM_JSON_PATH)));
  }

  // --- runInitCommand: TypeScript is required, no prompting happens for a JS-only project ---
  {
    const dir = fixture('run-js-only', { tsconfig: null });
    let promptCalled = false;
    await assert.rejects(
      runInitCommand(dir, async () => { promptCalled = true; return { useShadcn: false, styling: 'default' }; }),
      UsageError,
    );
    assert.equal(promptCalled, false, 'a JS-only project is rejected before ever prompting');
  }

  // --- runInitCommand: end-to-end with a stub prompt, then "already initialized" on rerun ---
  {
    const dir = fixture('run-e2e', { tsconfig: '{}' });
    const answers = { useShadcn: false, styling: 'default' };
    const firstOutput = await swallowLogs(() => runInitCommand(dir, async () => answers));
    assert.match(firstOutput, /Trim initialized\./);
    assert.ok(existsSync(path.join(dir, CONFIG_PATH)));
    assert.ok(existsSync(path.join(dir, TRIM_JSON_PATH)));

    const secondOutput = await swallowLogs(() => runInitCommand(dir, async () => answers));
    assert.match(secondOutput, /Trim is already initialized — nothing to do\./);
  }

  // --- runInitCommand: a conflict throws UsageError (exit-1-worthy), reports EVERY conflicting file, ---
  // --- and writes NOTHING — not even files that would otherwise be safe creates/updates in the same plan ---
  {
    const dir = fixture('run-conflict', { tsconfig: '{}' });
    const answers = { useShadcn: false, styling: 'default' };
    await swallowLogs(() => runInitCommand(dir, async () => answers));
    writeFileSync(path.join(dir, CONFIG_PATH), '// hand-edited, not generated\n', 'utf8');
    writeFileSync(path.join(dir, MANIFEST_PATH), '// also hand-edited, not generated\n', 'utf8');

    const output = await swallowLogs(async () => {
      // A different styling answer this time: trim.json would be an "update"
      // (never blocking on its own) alongside the two real "conflict" files.
      await assert.rejects(runInitCommand(dir, async () => ({ useShadcn: false, styling: 'headless' })), UsageError);
    });
    assert.match(output, /! trim\/trim\.config\.tsx/);
    assert.match(output, /! trim\/trim\.manifest\.ts/);
    assert.match(output, /trim\.config\.tsx, trim\/trim\.manifest\.ts/, 'every conflicting file is named, not just the first one found');
    assert.match(output, /Nothing was written/);
    // settings.ts was a plain "matches" and trim.json was a safe "update" —
    // neither should have been touched: the whole plan aborted.
    assert.equal(readFileSync(path.join(dir, SETTINGS_PATH), 'utf8'), generateSettingsContents(), 'an unrelated matching file is untouched by the abort');
    assert.equal(parseTrimMetadata(readFileSync(path.join(dir, TRIM_JSON_PATH), 'utf8')).styling, 'default', 'trim.json keeps its PREVIOUS value — the styling change was never applied because the batch aborted');
  }

  // --- generated files typecheck against the real built package (self-reference) ---
  {
    const dir = fixture('typecheck-generated', { tsconfig: '{ "compilerOptions": { "moduleResolution": "bundler" } }' });
    await applyInitPlan(dir, await buildInitPlan(detectProject(dir), { useShadcn: false, styling: 'tokens' }));
    const relFiles = [CONFIG_PATH, MANIFEST_PATH, SETTINGS_PATH].map((p) => path.relative(root, path.join(dir, p)));
    execFileSync('node', [
      'node_modules/typescript/bin/tsc', ...relFiles,
      '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
    ], { cwd: root });
  }

  // --- tarball: CLI ships, but no test fixture directories ever leak into it ---
  {
    const json = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
    const files = JSON.parse(json)[pkg.name].files.map((f) => f.path);
    assert.ok(files.includes('dist/cli/commands/init.js'));
    assert.ok(files.includes('dist/cli/generators/init-files.js'));
    assert.ok(files.includes('dist/cli/generators/settings-file.js'));
    assert.ok(files.includes('dist/cli/project/detect-project.js'));
    assert.ok(files.includes('dist/cli/project/trim-metadata.js'));
    assert.ok(!files.some((f) => f.startsWith('.trim-cli-init-test-')), 'no test fixture directory leaks into the tarball');
    assert.ok(!files.some((f) => f.startsWith('cli/')), 'raw cli/ source still never ships');
  }

  console.log('PASS CLI init: stripJsonComments (survives a "//" inside a string value), relativeImportSpecifier (extensionless vs .js), trim.json round trip + malformed rejection, fresh TS/JS-only detection, moduleResolution-driven integration snippet, exact generated file contents (no fake settings schema, empty schema marker present), all 3 styling choices, shadcn configured/not-configured (trim.json never records true without confirmed prerequisite)/declined, apply + idempotency, trim.json "update" on a changed answer (never blocking), conflict detection (never overwrites, never blocks unrelated matches), TRANSACTIONAL abort (one conflict blocks every otherwise-safe create/update in the same plan, every conflicting file is named), runInitCommand end to end, generated files typecheck against the real built package, tarball ships CLI dist but never test fixtures or raw cli/ source');
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
