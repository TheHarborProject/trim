// Tests for `trim detect` (cli/commands/detect.ts, cli/project/ts-program.ts,
// cli/project/detect-bindings.ts, cli/project/existing-bindings.ts,
// cli/generators/detect-plan.ts, cli/prompts/detect-prompts.ts).
//
// Fixtures live inside the repo tree (mkdtempSync under the repo root) so
// that generated files' self-references to the real built package resolve
// — NOT because detect needs a host `typescript`: it never touches one. It
// always parses with Trim's own bundled `@typescript/typescript6` (see
// cli/project/resolve-typescript.ts), so a host with no `typescript`
// installed at all still works fine — see the /tmp fixture below (one
// exception, deliberate), kept outside the repo tree specifically so no
// `node_modules/typescript` is reachable via Node's resolution walk-up,
// proving the host's own TypeScript (or lack of it) is irrelevant.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { buildHostProgram } = require(path.join(root, 'dist/cli/project/ts-program.js'));
const { scanForBindingCandidates, symbolNameToControlId } = require(path.join(root, 'dist/cli/project/detect-bindings.js'));
const { buildDetectBatchPlan } = require(path.join(root, 'dist/cli/generators/detect-plan.js'));
const { runDetectCommand } = require(path.join(root, 'dist/cli/commands/detect.js'));
const { runInitCommand } = require(path.join(root, 'dist/cli/commands/init.js'));
const { runNewControlCommand } = require(path.join(root, 'dist/cli/commands/new-control.js'));
const { UsageError } = require(path.join(root, 'dist/cli/dispatch.js'));

const testRoot = mkdtempSync(path.join(root, '.trim-cli-detect-test-'));

const swallowLogs = async (fn) => {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
};

/** `.prompts` on the returned function records every prompt text it was asked, in order — a scripted Ask never echoes its prompt to console.log the way the real, stdin-backed one writes to stdout, so a test that needs to see the actual prompt text (e.g. a shown default value) reads it from here instead. */
function scriptedAsk(answers) {
  const queue = [...answers];
  const prompts = [];
  const ask = async (promptText) => {
    prompts.push(promptText);
    if (queue.length === 0) throw new Error(`scriptedAsk: ran out of answers (last prompt: ${JSON.stringify(promptText)})`);
    return queue.shift();
  };
  ask.prompts = prompts;
  return ask;
}

/** The one comprehensive fixture covering every safe/unsafe shape from this step's own spec, section 28 — one file, so every case is scanned in a single pass. */
const CANDIDATES_SOURCE = `import { callback, createTrimController, controller } from "@theharborproject/trim";

// A) exported TrimBinding<boolean> via a hand-written, duck-typed object —
// no Trim import needed for THIS one at all, proving detection is purely
// structural, never a nominal check against a specific factory.
function makeManualBinding<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: (): T => value,
    set: (v: T): void => { value = v; for (const l of listeners) l(v); },
    subscribe: (l: (value: T) => void): (() => void) => { listeners.add(l); return () => listeners.delete(l); },
  };
}
export const manualBinding = makeManualBinding<boolean>(false);

// B) exported binding created through the public callback() factory
let contrast = false;
const contrastListeners = new Set<(value: boolean) => void>();
export const contrastBinding = callback<boolean>(
  () => contrast,
  (v) => { contrast = v; for (const l of contrastListeners) l(v); },
  (l) => { contrastListeners.add(l); return () => contrastListeners.delete(l); },
);

// B) exported binding created through the public controller() factory —
// TrimBinding<"light" | "dark" | "system"> inferred from the schema, never
// hand-annotated. "as const" matters here: without it, the schema array's
// element type widens to plain "string" and controller() correctly infers
// TrimBinding<string> instead — detect would then (correctly) report this
// as unsupported-type, not a fabricated segmented candidate. See this
// step's own report for why that's a real, documented interaction, not a
// detector bug.
const themeController = createTrimController(
  { theme: ["light", "dark", "system"] as const },
  { theme: "system" as const },
  "detect-fixture-theme",
);
export const themeBinding = controller(themeController, "theme");

// unrelated exported object that happens to have methods named get/set,
// but no subscribe at all — must never be mistaken for a TrimBinding.
export const notABinding = { get: () => 1, set: (v: number) => { void v; } };

// non-exported (module-local) binding — structurally valid, but not
// importable from trim/controls/<id>.trim.ts.
const localOnlyBinding = makeManualBinding<boolean>(true);
export function useLocalOnlyBinding() { return localOnlyBinding; }

// arbitrary (non-literal) string binding — not a finite union.
export const looseStringBinding = makeManualBinding<string>("hello");

// unsupported numeric binding
export const volumeBinding = makeManualBinding<number>(50);

// nullable binding
export const nullableBinding = makeManualBinding<boolean | undefined>(undefined);

// any/unknown binding
export const anyBinding = makeManualBinding<any>(null);
export const unknownBinding = makeManualBinding<unknown>(null);
`;

/** A fresh Trim-initialized project (real runInitCommand) plus the comprehensive candidates fixture above, under src/candidates.ts. */
async function detectFixture(name, { moduleResolution = 'bundler', useShadcn = false, extraFiles = {} } = {}) {
  const dir = path.join(testRoot, name);
  mkdirSync(path.join(dir, 'src'), { recursive: true });
  // node16/nodenext require `module` to match `moduleResolution` — an already-invalid pairing without
  // it happened to be tolerated by whatever TypeScript this fixture was resolving before (host-fallback
  // walked up to this repo's own TS5 devDependency); Trim's own bundled compiler is stricter, so a
  // fixture actually meaning to exercise node16 needs the real, valid pairing.
  const compilerOptions = { moduleResolution, strict: true };
  if (moduleResolution === 'node16' || moduleResolution === 'nodenext') compilerOptions.module = moduleResolution;
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions }), 'utf8');
  writeFileSync(path.join(dir, 'src/candidates.ts'), CANDIDATES_SOURCE, 'utf8');
  for (const [relPath, contents] of Object.entries(extraFiles)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, 'utf8');
  }
  await swallowLogs(() => runInitCommand(dir, async () => ({ useShadcn, styling: 'default' })));
  return dir;
}

function scan(dir) {
  const host = buildHostProgram(dir);
  return scanForBindingCandidates(host, dir);
}

try {
  // --- not initialized: clear failure, exact message, no scanning at all ---
  {
    const dir = path.join(testRoot, 'not-initialized');
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(path.join(dir, 'src/candidates.ts'), CANDIDATES_SOURCE, 'utf8');
    let scanned = false;
    await assert.rejects(runDetectCommand(dir, async () => { scanned = true; return ''; }), UsageError);
    await assert.rejects(runDetectCommand(dir, async () => ''), /this project is not initialized\.\nRun:\n {2}trim init/);
    assert.equal(scanned, false, 'never scans or prompts before confirming initialization');
  }

  // --- symbolNameToControlId: the proposed-id derivation itself ---
  {
    assert.equal(symbolNameToControlId('contrastBinding'), 'contrast');
    assert.equal(symbolNameToControlId('reducedMotionBinding'), 'reduced-motion');
    assert.equal(symbolNameToControlId('themeBinding'), 'theme');
    assert.equal(symbolNameToControlId('myToggle'), 'my-toggle');
  }

  // --- scan: correct classification of every shape in section 28's list ---
  {
    const dir = await detectFixture('scan-classification');
    const { filesExamined, candidates } = scan(dir);
    assert.equal(filesExamined, 1, 'only src/candidates.ts — trim/** and node_modules are never scanned');

    const byName = Object.fromEntries(candidates.map((c) => [c.symbolName, c]));

    assert.equal(byName.manualBinding.status, 'ready');
    assert.equal(byName.manualBinding.kind, 'boolean');
    assert.equal(byName.manualBinding.proposedId, 'manual');

    assert.equal(byName.contrastBinding.status, 'ready');
    assert.equal(byName.contrastBinding.kind, 'boolean');
    assert.equal(byName.contrastBinding.proposedId, 'contrast');
    assert.equal(byName.contrastBinding.importPath, 'src/candidates');

    assert.equal(byName.themeBinding.status, 'ready');
    assert.equal(byName.themeBinding.kind, 'segmented');
    assert.deepEqual(byName.themeBinding.options, ['light', 'dark', 'system'], 'literal values retained exactly, in declaration order');
    assert.equal(byName.themeBinding.proposedId, 'theme');

    assert.equal(byName.notABinding, undefined, 'an unrelated get/set-only object (no subscribe) is never even reported as a candidate');

    assert.equal(byName.localOnlyBinding.status, 'not-exported');
    assert.equal(byName.looseStringBinding.status, 'unsupported-type', 'an arbitrary (non-literal) string is not a finite union');
    assert.equal(byName.volumeBinding.status, 'unsupported-type');
    assert.equal(byName.nullableBinding.status, 'unsupported-type');
    assert.equal(byName.anyBinding.status, 'unsupported-type');
    assert.equal(byName.unknownBinding.status, 'unsupported-type');

    const readyCount = candidates.filter((c) => c.status === 'ready').length;
    assert.equal(readyCount, 3, 'manual, contrast, theme — exactly the 3 safely classifiable candidates');
  }

  // --- this step deliberately omits general "observed" heuristics (React ---
  // --- useState, localStorage-backed settings, etc.) beyond the one ---
  // --- mechanical case that falls out of the SAME structural check used ---
  // --- for READY (a module-local TrimBinding-shaped value) — see this ---
  // --- step's own report for why, per section 29's explicit permission to ---
  // --- state that decision rather than add weak detection. ---
  {
    const dir = path.join(testRoot, 'no-general-heuristics');
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', strict: true } }), 'utf8');
    writeFileSync(path.join(dir, 'src/app-patterns.tsx'), `import { useState } from "react";
export function Component() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  void setReducedMotion; void setTheme;
  return null;
}
export function readLocalStorageTheme(): string | null {
  return localStorage.getItem("theme");
}
`, 'utf8');
    await swallowLogs(() => runInitCommand(dir, async () => ({ useShadcn: false, styling: 'default' })));
    const { candidates } = scan(dir);
    assert.equal(candidates.length, 0, 'React useState / localStorage patterns produce NO candidates at all (never READY, never a fabricated OBSERVED heuristic) — see this block\'s own comment');
  }

  // --- proposed id / label are shown as EDITABLE defaults, not silently applied ---
  {
    const dir = await detectFixture('proposed-defaults-editable');
    const ask = scriptedAsk([
      '1', // All
      '', '', // manual: accept proposed id "manual", accept proposed label "Manual"
      '', '', // contrast: accept defaults
      '', '', // theme: accept defaults
    ]);
    await swallowLogs(() => runDetectCommand(dir, ask));
    assert.ok(ask.prompts.some((p) => p.includes('Control id: [manual]')), 'the proposed id is shown as a default, not silently applied');
    assert.ok(ask.prompts.some((p) => p.includes('Label: [Manual]')));
    assert.ok(existsSync(path.join(dir, 'trim/controls/manual.trim.ts')));
    assert.match(readFileSync(path.join(dir, 'trim/controls/manual.trim.ts'), 'utf8'), /label: "Manual"/);
  }

  // --- user-customized id and label override the proposal ---
  {
    const dir = await detectFixture('user-customized-id-label');
    await swallowLogs(() =>
      // "Select individually" asks include/exclude for EVERY ready candidate
      // first (manual, contrast, theme, in scan/declaration order), THEN
      // asks id/label confirmation only for the selected subset — the two
      // phases are not interleaved per candidate.
      runDetectCommand(dir, scriptedAsk([
        '2', // select individually
        'n', // exclude manualBinding
        'y', // include contrastBinding
        'n', // exclude themeBinding
        'high-contrast', 'High Contrast Mode', // contrastBinding's confirmation: custom id + label
      ])),
    );
    assert.ok(existsSync(path.join(dir, 'trim/controls/high-contrast.trim.ts')));
    assert.ok(!existsSync(path.join(dir, 'trim/controls/contrast.trim.ts')), 'the proposed id was overridden, not also created');
    const contents = readFileSync(path.join(dir, 'trim/controls/high-contrast.trim.ts'), 'utf8');
    assert.match(contents, /label: "High Contrast Mode"/);
    assert.match(contents, /import { contrastBinding } from "\.\.\/\.\.\/src\/candidates"/);
  }

  // --- duplicate id chosen for a second candidate in the same batch reprompts, never silently collides ---
  {
    const dir = await detectFixture('duplicate-id-in-batch');
    const output = await swallowLogs(() =>
      // Selection phase (include/exclude for all 3, in order) fully
      // precedes the confirmation phase (id/label for the selected ones).
      runDetectCommand(dir, scriptedAsk([
        '2', // select individually
        'y', // include manualBinding
        'y', // include contrastBinding
        'n', // exclude themeBinding
        'shared', '', // manualBinding's confirmation: id "shared", default label
        'shared', 'unique-name', '', // contrastBinding's confirmation: tries "shared" (rejected, already chosen in this batch), then "unique-name", default label
      ])),
    );
    assert.match(output, /"shared" was already chosen for another candidate in this batch/);
    assert.ok(existsSync(path.join(dir, 'trim/controls/shared.trim.ts')));
    assert.ok(existsSync(path.join(dir, 'trim/controls/unique-name.trim.ts')));
  }

  // --- existing Trim control (same id) is skipped — never offered again ---
  {
    const dir = await detectFixture('skip-existing-by-id');
    mkdirSync(path.join(dir, 'trim/controls'), { recursive: true });
    // A control literally named "manual" already exists (unrelated binding) — the proposed id "manual" must be treated as already-in-Trim.
    writeFileSync(path.join(dir, 'trim/controls/manual.trim.ts'), `import { defineBooleanControl } from "@theharborproject/trim";
export default defineBooleanControl({ id: "manual", label: "Manual", binding: { get: () => false, set: () => {}, subscribe: () => () => {} } });
`, 'utf8');
    const output = await swallowLogs(() => runDetectCommand(dir, scriptedAsk(['3'])));
    assert.match(output, /Already in Trim/);
    assert.match(output, /✓ manual — already declared/);
    assert.doesNotMatch(output.split('Already in Trim')[1].split('Ready to integrate')[0] ?? '', /theme|contrast/);
  }

  // --- existing Trim control using the SAME binding source (different id) is skipped too, without fragile text comparison ---
  {
    const dir = await detectFixture('skip-existing-by-binding-source');
    await swallowLogs(() => runNewControlCommand(dir, 'the-manual-one', scriptedAsk(['1', '', 'n', '2', '1', 'src/candidates', 'manualBinding'])));
    const { candidates } = scan(dir);
    assert.ok(candidates.some((c) => c.symbolName === 'manualBinding' && c.status === 'ready'), 'the scan itself still reports it as a raw candidate (that\'s fine — the command layer is what excludes it)');
    const output = await swallowLogs(() => runDetectCommand(dir, scriptedAsk(['3'])));
    assert.match(output, /Already in Trim/);
    assert.match(output, /✓ manual — already declared/, 'recognized by its SOURCE binding, even though the existing control uses a different id ("the-manual-one")');
    assert.ok(!existsSync(path.join(dir, 'trim/controls/manual.trim.ts')), 'never silently created a second control for the same binding');
  }

  // --- select All / select individually / cancel ---
  {
    const dir = await detectFixture('select-all');
    await swallowLogs(() => runDetectCommand(dir, scriptedAsk(['1', '', '', '', '', '', ''])));
    for (const id of ['manual', 'contrast', 'theme']) {
      assert.ok(existsSync(path.join(dir, `trim/controls/${id}.trim.ts`)), `${id} created via "All"`);
    }
  }
  {
    const dir = await detectFixture('select-individually');
    // Selection phase (all 3, in order) fully precedes confirmation (id/label for the one selected).
    await swallowLogs(() => runDetectCommand(dir, scriptedAsk(['2', 'y', 'n', 'n', '', ''])));
    assert.ok(existsSync(path.join(dir, 'trim/controls/manual.trim.ts')));
    assert.ok(!existsSync(path.join(dir, 'trim/controls/contrast.trim.ts')));
    assert.ok(!existsSync(path.join(dir, 'trim/controls/theme.trim.ts')));
  }
  {
    const dir = await detectFixture('cancel-writes-nothing');
    const manifestBefore = readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8');
    const output = await swallowLogs(() => runDetectCommand(dir, scriptedAsk(['3'])));
    assert.match(output, /Cancelled — nothing was created\./);
    assert.equal(readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8'), manifestBefore);
    assert.ok(!existsSync(path.join(dir, 'trim/controls')));
  }

  // --- batch transactionality: one bad id in the batch blocks EVERY candidate, not just that one ---
  {
    const dir = await detectFixture('batch-transactional');
    // Pre-declare "manual" as an existing control so the batch (manual, contrast, theme) has exactly one invalid entry.
    await swallowLogs(() => runNewControlCommand(dir, 'manual', scriptedAsk(['1', '', 'n', '1', 'y'])));
    await assert.rejects(
      buildDetectBatchPlan(dir, [
        { id: 'manual', label: 'Manual', kind: 'boolean', importPath: 'src/candidates', symbol: 'manualBinding' },
        { id: 'contrast', label: 'Contrast', kind: 'boolean', importPath: 'src/candidates', symbol: 'contrastBinding' },
        { id: 'theme', label: 'Theme', kind: 'segmented', options: [{ value: 'light', label: 'light' }, { value: 'dark', label: 'dark' }, { value: 'system', label: 'system' }], importPath: 'src/candidates', symbol: 'themeBinding' },
      ]),
      UsageError,
    );
    assert.ok(!existsSync(path.join(dir, 'trim/controls/contrast.trim.ts')), 'contrast (otherwise perfectly valid) was NOT created — the whole batch aborted');
    assert.ok(!existsSync(path.join(dir, 'trim/controls/theme.trim.ts')));
  }

  // --- manifest regeneration: existing + newly detected controls, lexical order ---
  {
    const dir = await detectFixture('manifest-regeneration');
    await swallowLogs(() => runNewControlCommand(dir, 'zzz-existing', scriptedAsk(['1', '', 'n', '1', 'y'])));
    await swallowLogs(() => runDetectCommand(dir, scriptedAsk(['1', '', '', '', '', '', ''])));
    const manifest = readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8');
    const order = [...manifest.matchAll(/import (\w+) from/g)].map((m) => m[1]);
    assert.deepEqual(order, ['contrast', 'manual', 'theme', 'zzzExisting'], 'lexical id order, existing control included alongside the newly detected ones');
  }

  // --- trim.settings.ts and trim.config.tsx stay byte-identical — detect never touches either ---
  {
    const dir = await detectFixture('settings-and-config-untouched');
    const settingsBefore = readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8');
    const configBefore = readFileSync(path.join(dir, 'trim/trim.config.tsx'), 'utf8');
    await swallowLogs(() => runDetectCommand(dir, scriptedAsk(['1', '', '', '', '', '', ''])));
    assert.equal(readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8'), settingsBefore, 'trim.settings.ts byte-identical — detected controls are host-managed');
    assert.equal(readFileSync(path.join(dir, 'trim/trim.config.tsx'), 'utf8'), configBefore, 'trim.config.tsx byte-identical — detect declares, it does not attach');
  }

  // --- generated files typecheck, node16/nodenext .js-suffixed imports, no internal/private Trim imports ---
  {
    const dir = await detectFixture('typecheck-and-node16', { moduleResolution: 'node16' });
    await swallowLogs(() => runDetectCommand(dir, scriptedAsk(['1', '', '', '', '', '', ''])));
    const contrastSource = readFileSync(path.join(dir, 'trim/controls/contrast.trim.ts'), 'utf8');
    assert.match(contrastSource, /from "\.\.\/\.\.\/src\/candidates\.js"/, 'node16 resolution: explicit .js suffix on the relative import');
    for (const file of ['trim/controls/manual.trim.ts', 'trim/controls/contrast.trim.ts', 'trim/controls/theme.trim.ts', 'trim/trim.manifest.ts', 'src/candidates.ts']) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      assert.doesNotMatch(source, /@theharborproject\/trim\/(react\/(controls|layouts)|core|advanced)\//, `${file}: no internal/granular-subpath Trim import`);
      assert.doesNotMatch(source, /\bsrc\/core\b|\bsrc\/react\b/, `${file}: no reference to this PACKAGE's own internal src/** (the fixture's own "src/candidates" never matches this)`);
    }
    const relFiles = ['trim/controls/manual.trim.ts', 'trim/controls/contrast.trim.ts', 'trim/controls/theme.trim.ts', 'trim/trim.manifest.ts', 'trim/trim.settings.ts', 'src/candidates.ts'].map((p) => path.relative(root, path.join(dir, p)));
    execFileSync('node', [
      'node_modules/typescript/bin/tsc', ...relFiles,
      '--noEmit', '--strict', '--module', 'node16', '--moduleResolution', 'node16', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
    ], { cwd: root });
  }

  // --- shadcn preference has zero effect on detection or generation ---
  {
    const dirFalse = await detectFixture('shadcn-false', { useShadcn: false });
    const dirTrue = await detectFixture('shadcn-true', { useShadcn: false, extraFiles: { 'components.json': '{"aliases":{"ui":"@/components/ui"}}' } });
    // re-init dirTrue with useShadcn true now that components.json exists
    await swallowLogs(() => runInitCommand(dirTrue, async () => ({ useShadcn: true, styling: 'default' })));
    const outFalse = await swallowLogs(() => runDetectCommand(dirFalse, scriptedAsk(['3'])));
    const outTrue = await swallowLogs(() => runDetectCommand(dirTrue, scriptedAsk(['3'])));
    const normalize = (s) => s.replace(/\d+ms/g, 'Nms');
    assert.equal(normalize(outFalse), normalize(outTrue), 'identical scan/report output regardless of trim.json\'s shadcn preference');
  }

  // --- host with NO `typescript` installed at all still works: detect never touches the host's TypeScript, only Trim's own bundled compiler ---
  {
    const dir = path.join('/tmp', `trim-detect-no-ts-${process.pid}`);
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    mkdirSync(path.join(dir, 'trim'), { recursive: true });
    writeFileSync(path.join(dir, 'tsconfig.json'), '{}', 'utf8');
    writeFileSync(path.join(dir, 'src/index.ts'), 'export const x = 1;\n', 'utf8'); // a real (if trivial) root file, so tsconfig parsing itself succeeds — this test is about host TypeScript resolution, not "no inputs found"
    const { serializeTrimMetadata } = require(path.join(root, 'dist/cli/project/trim-metadata.js'));
    writeFileSync(path.join(dir, 'trim/trim.json'), serializeTrimMetadata({ version: 1, shadcn: false, styling: 'default' }), 'utf8');
    try {
      const out = await swallowLogs(() => runDetectCommand(dir, async () => { throw new Error('no candidates here — detect must never prompt'); }));
      assert.match(out, /0 controls can be generated safely\./);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- failure: tsconfig.json cannot be parsed ---
  {
    const dir = await detectFixture('malformed-tsconfig');
    writeFileSync(path.join(dir, 'tsconfig.json'), '{ not json at all', 'utf8');
    await assert.rejects(runDetectCommand(dir, async () => ''), UsageError);
    await assert.rejects(runDetectCommand(dir, async () => ''), /could not parse/);
  }

  // --- failure: selected binding disappeared between scan and generation ---
  {
    const dir = await detectFixture('binding-disappeared');
    writeFileSync(path.join(dir, 'src/candidates.ts'), '', 'utf8'); // the file scan already happened against is now empty
    await assert.rejects(
      buildDetectBatchPlan(dir, [{ id: 'contrast', label: 'Contrast', kind: 'boolean', importPath: 'src/candidates', symbol: 'contrastBinding' }]),
      /no longer appears to be exported/,
    );
    assert.ok(!existsSync(path.join(dir, 'trim/controls/contrast.trim.ts')));
  }
  {
    const dir = await detectFixture('binding-file-removed');
    rmSync(path.join(dir, 'src/candidates.ts'));
    await assert.rejects(
      buildDetectBatchPlan(dir, [{ id: 'contrast', label: 'Contrast', kind: 'boolean', importPath: 'src/candidates', symbol: 'contrastBinding' }]),
      /could not be found/,
    );
  }

  // --- failure: chosen id conflicts with an existing control ---
  {
    const dir = await detectFixture('id-conflicts-with-existing');
    await swallowLogs(() => runNewControlCommand(dir, 'contrast', scriptedAsk(['1', '', 'n', '2', '1', 'src/candidates', 'contrastBinding'])));
    await assert.rejects(
      buildDetectBatchPlan(dir, [{ id: 'contrast', label: 'Contrast', kind: 'boolean', importPath: 'src/candidates', symbol: 'manualBinding' }]),
      /already exists/,
    );
  }

  // --- tarball: detect's CLI files ship ---
  {
    const json = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
    const files = JSON.parse(json)[pkg.name].files.map((f) => f.path);
    for (const f of ['dist/cli/commands/detect.js', 'dist/cli/project/ts-program.js', 'dist/cli/project/detect-bindings.js', 'dist/cli/project/existing-bindings.js', 'dist/cli/generators/detect-plan.js', 'dist/cli/prompts/detect-prompts.js']) {
      assert.ok(files.includes(f), `${f} should ship in dist/cli`);
    }
  }

  // --- verify from an ACTUAL packed-and-extracted tarball, not just repo-relative execution ---
  {
    const packDir = mkdtempSync(path.join(testRoot, 'pack-'));
    const tarballName = execFileSync('npm', ['pack', '--silent', '--pack-destination', packDir], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();
    const extractDir = path.join(packDir, 'extracted');
    mkdirSync(extractDir, { recursive: true });
    execFileSync('tar', ['xzf', path.join(packDir, tarballName), '-C', extractDir]);
    const installedBin = path.join(extractDir, 'package/dist/cli/bin/trim.js');

    const consumerDir = path.join(packDir, 'consumer');
    mkdirSync(path.join(consumerDir, 'src'), { recursive: true });
    writeFileSync(path.join(consumerDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', strict: true } }), 'utf8');
    writeFileSync(path.join(consumerDir, 'src/candidates.ts'), CANDIDATES_SOURCE, 'utf8');
    execFileSync('node', [installedBin, 'init'], { cwd: consumerDir, input: 'n\n1\n' });
    const detectOutput = execFileSync('node', [installedBin, 'detect'], { cwd: consumerDir, input: '1\n\n\n\n\n\n\n', encoding: 'utf8' });
    assert.match(detectOutput, /Ready to integrate/);
    assert.ok(existsSync(path.join(consumerDir, 'trim/controls/contrast.trim.ts')), 'trim detect worked from the actual packed-and-extracted tarball, not just repo-relative execution');
  }

  console.log('PASS CLI detect: not initialized fails clearly before any scan/prompt, symbolNameToControlId proposal, scan classification (boolean/segmented ready with literal values retained in order; unrelated get/set-only object never a candidate at all; non-exported/loose-string/numeric/nullable/any/unknown all OBSERVED-or-excluded, never READY), no general "observed" heuristics beyond the mechanical module-local-binding case (React useState/localStorage produce zero candidates, by design), proposed id/label shown as editable defaults, user-customized id/label, duplicate id within a batch reprompts, existing control skipped both by id and by underlying binding source (no fragile text comparison), select All/individually/Cancel (cancel writes nothing), batch transactionality (one invalid entry blocks the whole batch), manifest regeneration (lexical order, existing + detected together), trim.settings.ts/trim.config.tsx byte-identical, generated files typecheck with node16 .js-suffixed imports and no internal/granular Trim imports, shadcn preference has zero effect, host with no `typescript` installed at all still scans fine (Trim never touches host TypeScript, only its own bundled compiler), clear failures (malformed tsconfig, binding disappeared/removed between scan and generation, id conflicts with an existing control), tarball ships detect\'s CLI files, and detect works from an actual packed-and-extracted tarball');
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
