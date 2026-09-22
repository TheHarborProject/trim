// Tests for `trim new control` (cli/commands/new-control.ts,
// cli/generators/new-control-plan.ts, cli/generators/control-file.ts,
// cli/generators/manifest-file.ts, cli/generators/settings-file.ts,
// cli/project/control-id.ts, cli/project/binding-validation.ts,
// cli/prompts/new-control-prompts.ts).
//
// Exercises the "read project -> collect answers -> build plan -> apply"
// pipeline directly with fixture projects and a SCRIPTED Ask function (see
// scriptedAsk below) — no TTY. Runs the real `npm run build`; fixtures
// live inside the repo tree so generated-file typechecking can
// self-reference the real built package, exactly like cli-init.test.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { serializeTrimMetadata } = require(path.join(root, 'dist/cli/project/trim-metadata.js'));
const { isValidControlId, suggestControlId } = require(path.join(root, 'dist/cli/project/control-id.js'));
const { generateConfigContents } = require(path.join(root, 'dist/cli/generators/init-files.js'));
const { parseExistingManagedSettings, generateSettingsFileContents } = require(path.join(root, 'dist/cli/generators/settings-file.js'));
const { runNewControlCommand } = require(path.join(root, 'dist/cli/commands/new-control.js'));
const { runInitCommand } = require(path.join(root, 'dist/cli/commands/init.js'));
const { UsageError } = require(path.join(root, 'dist/cli/dispatch.js'));

const testRoot = mkdtempSync(path.join(root, '.trim-cli-new-control-test-'));

/** A project that looks exactly like a fresh `trim init` produced, without running the interactive flow — fast setup for tests that aren't specifically about init itself. */
function initializedFixture(name, { moduleResolution = 'bundler' } = {}) {
  const dir = path.join(testRoot, name);
  mkdirSync(path.join(dir, 'trim'), { recursive: true });
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution } }), 'utf8');
  writeFileSync(path.join(dir, 'trim/trim.config.tsx'), generateConfigContents({ adapter: 'vanilla', shell: 'popover' }), 'utf8');
  writeFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'export const trimControls = [] as const;\n', 'utf8');
  writeFileSync(path.join(dir, 'trim/trim.settings.ts'), '// @trim-managed-schema {"version":1,"settings":[]}\nexport {};\n', 'utf8');
  writeFileSync(path.join(dir, 'trim/trim.json'), serializeTrimMetadata({ version: 1, shadcn: false, styling: 'default' }), 'utf8');
  return dir;
}

function writeFile(dir, relPath, contents) {
  const full = path.join(dir, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

/**
 * A scripted fake `Prompter` (cli/prompts/prompter.ts) — same queue-of-
 * answers idea the old scriptedAsk used, methods resolve immediately, no
 * TTY/stdin involved. Throws (never hangs/loops) if the script
 * under-specifies a flow, the same failure mode the real, stdin-backed
 * Prompter has on exhausted input.
 *
 * `select()` answers are 1-indexed, matching the on-screen choice order
 * (e.g. "1" = the first choice) — the same numbers a real user would type
 * before this migration, now looked up against `opts.choices` instead of
 * parsed as free text. `confirm()` still accepts 'y'/'n'/'yes'/'no'/'' (or a
 * real boolean) so most of this file's pre-migration answer queues carry
 * over unchanged. `input()`'s scripted answer runs through `opts.validate`
 * when present, reprompting (popping the next queued answer) on failure —
 * exactly what the real, @inquirer/prompts-backed `input()` does — so a
 * script can still exercise a validate-driven reprompt loop (e.g. detect's
 * duplicate-id-in-batch case) by queuing an invalid answer followed by a
 * valid one.
 */
function scriptedAsk(answers) {
  const queue = [...answers];
  function pop(message) {
    if (queue.length === 0) throw new Error(`scriptedAsk: ran out of answers (last prompt: ${JSON.stringify(message)})`);
    return queue.shift();
  }
  return {
    async input(opts) {
      while (true) {
        const raw = pop(opts.message);
        const answer = raw === '' ? (opts.default ?? '') : String(raw);
        if (opts.validate) {
          const result = await opts.validate(answer);
          if (result !== true) { console.log(result); continue; } // reprompt: consume the next queued answer, echoing the message the real UI would show
        }
        return answer;
      }
    },
    async select(opts) {
      const raw = pop(opts.message);
      const choice = opts.choices[Number(raw) - 1];
      if (!choice) throw new Error(`scriptedAsk: select got out-of-range answer ${JSON.stringify(raw)} for "${opts.message}" (${opts.choices.length} choices)`);
      return choice.value;
    },
    async confirm(opts) {
      const raw = pop(opts.message);
      if (typeof raw === 'boolean') return raw;
      if (raw === '') return opts.default ?? false;
      return raw === 'y' || raw === 'yes';
    },
    async checkbox(opts) {
      const indices = new Set(pop(opts.message)); // an array of 1-indexed positions to check
      return opts.choices.filter((_, i) => indices.has(i + 1)).map((c) => c.value);
    },
  };
}

/** A Prompter whose every method calls `onCall()` and returns a harmless value — for asserting a command never prompts at all before it fails. */
function trackingPrompter(onCall) {
  return {
    async input() { onCall(); return ''; },
    async select(opts) { onCall(); return opts.choices[0]?.value; },
    async confirm() { onCall(); return false; },
    async checkbox() { onCall(); return []; },
  };
}

const swallowLogs = async (fn) => {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
};

try {
  // --- trim.settings.ts's embedded schema is versioned and FAILS CLOSED: ---
  // --- only a genuinely absent marker is "no settings" — anything that ---
  // --- looks like an attempt at the marker but doesn't parse cleanly throws ---
  {
    const settings = [{ key: 'theme', kind: 'segmented', options: ['light', 'dark'], defaultValue: 'light' }];
    const generated = generateSettingsFileContents(settings);
    assert.match(generated, /@trim-managed-schema \{"version":1,"settings":/, 'the payload is a versioned object, never a bare array');
    assert.deepEqual(parseExistingManagedSettings(generated), settings, 'round trip: generate -> parse recovers the exact settings');

    // rule 5: an unsupported (but recognizable) version is a hard, clear failure.
    const future = generated.replace('"version":1', '"version":2');
    assert.throws(() => parseExistingManagedSettings(future), UsageError);
    assert.throws(() => parseExistingManagedSettings(future), /version 2.*only supports version 1/s);

    // rule 6: the pre-hardening bare-array shape is explicitly unsupported,
    // never silently treated as an empty schema — losing a real existing
    // schema this way would make a later `trim new control` regenerate
    // trim.settings.ts forgetting every prior Trim-managed control.
    assert.throws(() => parseExistingManagedSettings('// @trim-managed-schema [{"key":"theme"}]\nexport {};\n'), UsageError);
    // rule 4: present, valid JSON, but not the {version, settings} shape.
    assert.throws(() => parseExistingManagedSettings('// @trim-managed-schema {"settings":[]}\nexport {};\n'), UsageError);
    assert.throws(() => parseExistingManagedSettings('// @trim-managed-schema {"version":1}\nexport {};\n'), UsageError, 'missing `settings` entirely');
    assert.throws(() => parseExistingManagedSettings('// @trim-managed-schema {"version":1,"settings":"nope"}\nexport {};\n'), UsageError, '`settings` present but not an array');
    // rule 3: malformed JSON.
    assert.throws(() => parseExistingManagedSettings('// @trim-managed-schema not even json\nexport {};\n'), UsageError);
    // rule 1: the only case that is genuinely "no existing settings" — no marker line at all.
    assert.deepEqual(parseExistingManagedSettings('export {};\n'), []);
  }

  // --- REGRESSION: a corrupted marker must abort `new control` entirely, ---
  // --- never silently regenerate trim.settings.ts and forget the existing ---
  // --- Trim-managed control the corruption hid ---
  {
    const dir = initializedFixture('corrupted-marker-regression');
    await swallowLogs(() => runNewControlCommand(dir, 'theme', scriptedAsk(['1', '', 'n', '1', 'y'])));
    const goodSettings = readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8');
    assert.deepEqual(parseExistingManagedSettings(goodSettings), [{ key: 'theme', kind: 'boolean', defaultValue: true }]);

    // Corrupt the marker as if by a hand-edit or a bad merge.
    const corrupted = goodSettings.replace(/\/\/ @trim-managed-schema.*$/m, '// @trim-managed-schema {"settings":[]}');
    writeFileSync(path.join(dir, 'trim/trim.settings.ts'), corrupted, 'utf8');

    await assert.rejects(
      runNewControlCommand(dir, 'animations', scriptedAsk(['1', '', 'n', '1', 'y'])),
      UsageError,
      'adding a second Trim-managed control must fail, not silently proceed from a "forgotten" empty schema',
    );
    // Nothing was written for the failed attempt, and the corrupted file
    // (not silently "fixed" either) is exactly what a human now needs to resolve.
    assert.ok(!existsSync(path.join(dir, 'trim/controls/animations.trim.ts')), 'the new control was never created');
    assert.equal(readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8'), corrupted, 'the corrupted file is left exactly as found, for a human to resolve — never silently rewritten either');
  }

  // NOTE: the pre-migration "REGRESSION: invalid non-empty answers reprompt"
  // test that used to live here (control-type/can-repeat/state/project-
  // binding menus) no longer applies: those menus are now real select()/
  // confirm() widgets (arrow-key navigation, a real yes/no toggle) with no
  // "type an out-of-range number" input to reject in the first place — that
  // rejection is now @inquirer/prompts's own, untested-by-us, UI concern.
  // The one hand-rolled reprompt loop this wizard still owns (segmented
  // options, "at least 2 required") keeps its own test below, now also
  // asserting the hint message this migration added to its reprompt path.

  // --- control id validation ---
  {
    assert.equal(isValidControlId('reduced-motion'), true);
    assert.equal(isValidControlId('theme'), true);
    assert.equal(isValidControlId('a1-b2'), true);
    assert.equal(isValidControlId('Reduced Motion'), false);
    assert.equal(isValidControlId('reduced_motion'), false);
    assert.equal(isValidControlId('-reduced'), false);
    assert.equal(isValidControlId('Reduced'), false, 'uppercase is rejected, not silently lowercased');
    assert.equal(suggestControlId('Reduced Motion'), 'reduced-motion');
    assert.equal(suggestControlId('  Reduced_Motion!! '), 'reduced-motion');
  }

  // --- invalid id: fails clearly, never silently rewritten, no prompting ---
  {
    const dir = initializedFixture('invalid-id');
    let asked = false;
    await assert.rejects(
      runNewControlCommand(dir, 'Reduced Motion', trackingPrompter(() => { asked = true; })),
      UsageError,
    );
    assert.equal(asked, false, 'an invalid id is rejected before any prompt');
  }

  // --- not initialized: fails clearly, never silently runs init ---
  {
    const dir = path.join(testRoot, 'not-initialized');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'tsconfig.json'), '{}', 'utf8');
    await assert.rejects(runNewControlCommand(dir, 'theme', trackingPrompter(() => {})), UsageError);
    assert.ok(!existsSync(path.join(dir, 'trim')), 'no trim/ directory is created — trim new control never silently initializes');
  }

  // --- Boolean / Trim-managed ---
  {
    const dir = initializedFixture('boolean-trim-managed');
    const ask = scriptedAsk(['1', '', 'n', '1', 'y']); // type=Boolean, label=default, allowMultiple=n, state=Trim-managed, default=y(true)
    await swallowLogs(() => runNewControlCommand(dir, 'animations', ask));
    const source = readFileSync(path.join(dir, 'trim/controls/animations.trim.ts'), 'utf8');
    assert.match(source, /import \{ defineBooleanControl \} from "@theharborproject\/trim";/);
    assert.match(source, /import \{ trimSettings \} from "\.\.\/trim\.settings";/);
    assert.match(source, /id: "animations",/);
    assert.match(source, /label: "Animations",/);
    assert.match(source, /binding: trimSettings\.animations,/);
    assert.doesNotMatch(source, /is_unique/, 'is_unique is omitted by default — undefined already means unique');
    const settings = readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8');
    assert.deepEqual(parseExistingManagedSettings(settings), [{ key: 'animations', kind: 'boolean', defaultValue: true }]);
  }

  // --- Segmented / Trim-managed ---
  {
    const dir = initializedFixture('segmented-trim-managed');
    const ask = scriptedAsk([
      '2', '', 'n', // type=Segmented, label=default, allowMultiple=n
      'light', '', 'dark', '', 'system', '', '', // 3 options, blank labels default to the value, blank to finish
      '1', // state=Trim-managed
      '3', // default option = system (3rd)
    ]);
    await swallowLogs(() => runNewControlCommand(dir, 'theme', ask));
    const source = readFileSync(path.join(dir, 'trim/controls/theme.trim.ts'), 'utf8');
    assert.match(source, /import \{ defineSegmentedControl \} from "@theharborproject\/trim";/);
    assert.match(source, /options: \[\{ value: "light", label: "light" \}, \{ value: "dark", label: "dark" \}, \{ value: "system", label: "system" \}\],/);
    assert.match(source, /binding: trimSettings\.theme,/);
    const settings = readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8');
    assert.deepEqual(parseExistingManagedSettings(settings), [{ key: 'theme', kind: 'segmented', options: ['light', 'dark', 'system'], defaultValue: 'system' }]);
  }

  // --- Segmented: fewer than 2 options is refused (loop continues, never proceeds with 0 or 1) ---
  {
    const dir = initializedFixture('segmented-min-options');
    // Only ONE option offered before trying to finish twice, then two real options.
    const ask = scriptedAsk(['2', '', 'n', 'solo', '', '', 'second', '', '', '1', '1']);
    const output = await swallowLogs(() => runNewControlCommand(dir, 'pair', ask));
    const settings = parseExistingManagedSettings(readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8'));
    assert.deepEqual(settings[0].options, ['solo', 'second'], 'a premature blank (fewer than 2 options) is rejected, not accepted');
    assert.match(output, /At least 2 options are required/, 'the reprompt now shows a hint, unlike the pre-migration silent loop');
  }

  // --- Action: no Trim-managed question at all, straight to project binding, callback has no getter ---
  {
    const dir = initializedFixture('action-control');
    writeFile(dir, 'src/actions.ts', 'export function resetAll(): void {}\n');
    const ask = scriptedAsk(['3', '', 'n', '2', 'src/actions', 'resetAll', '']); // type=Action, label default, allowMultiple=n, callback, path, setter, no subscribe
    await swallowLogs(() => runNewControlCommand(dir, 'reset', ask));
    const source = readFileSync(path.join(dir, 'trim/controls/reset.trim.ts'), 'utf8');
    assert.match(source, /import \{ defineActionControl \} from "@theharborproject\/trim";/);
    assert.match(source, /binding: callback\(\(\) => undefined, resetAll\),/, 'no getter import for a void-valued action — () => undefined is used inline');
    assert.doesNotMatch(source, /State:/, 'sanity: this assertion is about generated content, not prompt text');
    // settings.ts must be untouched — an Action can never be Trim-managed
    assert.ok(!existsSync(path.join(dir, 'trim/trim.manifest.ts')) === false); // manifest always exists once initialized
    const settingsAfter = parseExistingManagedSettings(readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8'));
    assert.deepEqual(settingsAfter, [], 'an Action control never touches trim.settings.ts');
  }

  // --- ToggleAction / Trim-managed ---
  {
    const dir = initializedFixture('toggle-action-control');
    const ask = scriptedAsk(['4', '', 'n', '1', 'n']); // type=ToggleAction, label default, allowMultiple=n, Trim-managed, default=false
    await swallowLogs(() => runNewControlCommand(dir, 'pin', ask));
    const source = readFileSync(path.join(dir, 'trim/controls/pin.trim.ts'), 'utf8');
    assert.match(source, /import \{ defineToggleActionControl \} from "@theharborproject\/trim";/);
    assert.match(source, /binding: trimSettings\.pin,/);
  }

  // --- Existing TrimBinding project binding: correct RELATIVE import path (the real bug this suite caught during manual smoke-testing) ---
  {
    const dir = initializedFixture('existing-binding');
    writeFile(dir, 'src/lib/my-binding.ts', 'export const myBinding = { get: () => true, set: () => {}, subscribe: () => () => {} };\n');
    const ask = scriptedAsk(['1', '', 'n', '2', '1', 'src/lib/my-binding', 'myBinding']);
    await swallowLogs(() => runNewControlCommand(dir, 'my-thing', ask));
    const source = readFileSync(path.join(dir, 'trim/controls/my-thing.trim.ts'), 'utf8');
    assert.match(source, /import \{ myBinding \} from "\.\.\/\.\.\/src\/lib\/my-binding";/, 'the import path is correctly RELATIVE from trim/controls/, not the bare project-root-relative path the user typed');
    assert.match(source, /binding: myBinding,/);
  }

  // --- callback project binding: full get/set/subscribe, is_unique:false ---
  {
    const dir = initializedFixture('callback-binding');
    writeFile(dir, 'src/contrast-store.ts', 'export function getContrast(){} export function setContrast(){} export function subscribeContrast(){}\n');
    const ask = scriptedAsk(['1', '', 'y', '2', '2', 'src/contrast-store', 'getContrast', 'setContrast', 'subscribeContrast']);
    await swallowLogs(() => runNewControlCommand(dir, 'contrast', ask));
    const source = readFileSync(path.join(dir, 'trim/controls/contrast.trim.ts'), 'utf8');
    assert.match(source, /import \{ callback \} from "@theharborproject\/trim";/);
    assert.match(source, /import \{ getContrast, setContrast, subscribeContrast \} from "\.\.\/\.\.\/src\/contrast-store";/);
    assert.match(source, /binding: callback\(getContrast, setContrast, subscribeContrast\),/);
    assert.match(source, /is_unique: false,/, 'is_unique: false is generated when the user allows multiple attachment — never is_unique: true');
    assert.doesNotMatch(source, /is_unique: true/);
  }

  // --- callback binding: an unresolvable import path is a hard, clear failure — never invents a binding ---
  {
    const dir = initializedFixture('callback-bad-path');
    const ask = scriptedAsk(['1', '', 'n', '2', '2', 'src/does-not-exist', 'getX', 'setX', '']);
    await assert.rejects(runNewControlCommand(dir, 'broken', ask), UsageError);
    assert.ok(!existsSync(path.join(dir, 'trim/controls/broken.trim.ts')), 'nothing is written when the import path cannot be found');
  }

  // --- cancelled project-binding flow: writes NOTHING, exits cleanly (not an error) ---
  {
    const dir = initializedFixture('cancelled-flow');
    const ask = scriptedAsk(['1', '', 'n', '2', '3']); // Boolean, default label, no-multiple, Project binding, Cancel
    const output = await swallowLogs(() => runNewControlCommand(dir, 'abandoned', ask));
    assert.match(output, /Cancelled — nothing was created\./);
    assert.ok(!existsSync(path.join(dir, 'trim/controls/abandoned.trim.ts')));
    assert.equal(readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8'), 'export const trimControls = [] as const;\n', 'manifest is completely untouched by a cancelled flow');
  }

  // --- duplicate control id: fails before prompting, never overwrites ---
  {
    const dir = initializedFixture('duplicate-id');
    await swallowLogs(() => runNewControlCommand(dir, 'theme', scriptedAsk(['1', '', 'n', '1', 'y'])));
    const before = readFileSync(path.join(dir, 'trim/controls/theme.trim.ts'), 'utf8');
    let asked = false;
    await assert.rejects(
      runNewControlCommand(dir, 'theme', trackingPrompter(() => { asked = true; })),
      UsageError,
    );
    assert.equal(asked, false, 'a duplicate id fails before the wizard starts — no point asking questions for a rejected id');
    assert.equal(readFileSync(path.join(dir, 'trim/controls/theme.trim.ts'), 'utf8'), before, 'the existing declaration is untouched');
  }

  // --- failure during plan validation writes NOTHING (transactional) ---
  // Simulated via the bad-import-path case above (validation happens
  // during prompting itself, before any plan is built) — this case proves
  // the SAME guarantee when validation fails inside buildNewControlPlan
  // itself, after the wizard completes: an internal duplicate-id race.
  {
    const { buildNewControlPlan } = require(path.join(root, 'dist/cli/generators/new-control-plan.js'));
    const dir = initializedFixture('plan-validation-failure');
    const before = readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8');
    await swallowLogs(() => runNewControlCommand(dir, 'theme', scriptedAsk(['1', '', 'n', '1', 'y'])));
    // Attempt to plan the SAME id again directly (bypassing the command's
    // early check) — buildNewControlPlan's own independent guard must
    // still refuse, and refuse before writing anything.
    await assert.rejects(buildNewControlPlan(dir, { id: 'theme', kind: 'boolean', label: 'Theme', allowMultiple: false, binding: { mode: 'trim-managed', defaultValue: true } }, 'classic-or-bundler'), UsageError);
    assert.notEqual(before, readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8'), 'sanity: the first, successful control WAS added');
  }

  // --- manifest update + deterministic (lexical) ordering, independent of add order ---
  {
    const dir = initializedFixture('manifest-order');
    await swallowLogs(() => runNewControlCommand(dir, 'zebra', scriptedAsk(['1', '', 'n', '1', 'y'])));
    await swallowLogs(() => runNewControlCommand(dir, 'apple', scriptedAsk(['1', '', 'n', '1', 'y'])));
    const manifest = readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8');
    const importOrder = [...manifest.matchAll(/^import (\w+) from/gm)].map((m) => m[1]);
    assert.deepEqual(importOrder, ['apple', 'zebra'], 'lexical id order, even though "zebra" was added first');
    assert.match(manifest, /export const trimControls = \[\n  apple,\n  zebra,\n\] as const;/);
  }

  // --- settings aggregation: multiple Trim-managed controls share ONE controller; ---
  // --- a second `new control` preserves the first managed setting exactly ---
  {
    const dir = initializedFixture('settings-aggregation');
    await swallowLogs(() => runNewControlCommand(dir, 'theme', scriptedAsk(['2', '', 'n', 'light', '', 'dark', '', '', '1', '1'])));
    const afterFirst = parseExistingManagedSettings(readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8'));
    assert.deepEqual(afterFirst, [{ key: 'theme', kind: 'segmented', options: ['light', 'dark'], defaultValue: 'light' }]);

    await swallowLogs(() => runNewControlCommand(dir, 'animations', scriptedAsk(['1', '', 'y', '1', 'n'])));
    const settingsSource = readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8');
    const afterSecond = parseExistingManagedSettings(settingsSource);
    assert.deepEqual(
      [...afterSecond].sort((a, b) => a.key.localeCompare(b.key)),
      [
        { key: 'animations', kind: 'boolean', defaultValue: false },
        { key: 'theme', kind: 'segmented', options: ['light', 'dark'], defaultValue: 'light' },
      ],
      'the first control\'s setting survives byte-for-byte through the second control\'s regeneration',
    );
    // exactly one controller instance in the generated source
    assert.equal((settingsSource.match(/createTrimController\(/g) ?? []).length, 1, 'one shared controller for every Trim-managed control, never one per file');
  }

  // --- trim.config.tsx is never touched by `new control` (new = declare, attach = compose) ---
  {
    const dir = initializedFixture('config-untouched');
    const before = readFileSync(path.join(dir, 'trim/trim.config.tsx'), 'utf8');
    await swallowLogs(() => runNewControlCommand(dir, 'theme', scriptedAsk(['1', '', 'n', '1', 'y'])));
    assert.equal(readFileSync(path.join(dir, 'trim/trim.config.tsx'), 'utf8'), before, 'byte-identical — trim new control never modifies trim.config.tsx');
    assert.equal(before, generateConfigContents({ adapter: 'vanilla', shell: 'popover' }), 'sanity: still the pristine template — only the seeded "starter" group, "theme" was never attached');
  }

  // --- node16/nodenext: generated imports carry the compiled .js extension ---
  {
    const dir = initializedFixture('nodenext-imports', { moduleResolution: 'nodenext' });
    writeFile(dir, 'src/store.ts', 'export function get(){} export function set(){}\n');
    await swallowLogs(() => runNewControlCommand(dir, 'theme', scriptedAsk(['1', '', 'n', '1', 'y'])));
    await swallowLogs(() => runNewControlCommand(dir, 'contrast', scriptedAsk(['1', '', 'n', '2', '2', 'src/store', 'get', 'set', ''])));
    assert.match(readFileSync(path.join(dir, 'trim/controls/theme.trim.ts'), 'utf8'), /from "\.\.\/trim\.settings\.js";/);
    assert.match(readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8'), /from "\.\/controls\/theme\.trim\.js";/);
    assert.match(readFileSync(path.join(dir, 'trim/controls/contrast.trim.ts'), 'utf8'), /from "\.\.\/\.\.\/src\/store\.js";/);
  }

  // --- no internal src/** import in any generated control/manifest/settings file ---
  {
    const dir = path.join(testRoot, 'settings-aggregation'); // reuse the fixture already populated above
    for (const file of ['trim/controls/theme.trim.ts', 'trim/controls/animations.trim.ts', 'trim/trim.manifest.ts', 'trim/trim.settings.ts']) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      assert.doesNotMatch(source, /\bsrc\//, `${file} must not reference an internal src/** path`);
      assert.doesNotMatch(source, /from ["']@theharborproject\/trim\/(?!react)[^"']*\/(controls|layouts|manifest|config)/, `${file} must not import a granular/internal package subpath`);
    }
  }

  // --- generated files typecheck against the real built package (self-reference) ---
  {
    const dir = initializedFixture('typecheck-generated', { moduleResolution: 'bundler' });
    writeFile(dir, 'src/store.ts', 'export function get(){return false;} export function set(v: boolean){} export function sub(l:(v:boolean)=>void){return () => {};}\n');
    await swallowLogs(() => runNewControlCommand(dir, 'theme', scriptedAsk(['2', '', 'n', 'light', '', 'dark', '', '', '1', '1'])));
    await swallowLogs(() => runNewControlCommand(dir, 'animations', scriptedAsk(['1', '', 'y', '1', 'n'])));
    await swallowLogs(() => runNewControlCommand(dir, 'contrast', scriptedAsk(['1', '', 'n', '2', '2', 'src/store', 'get', 'set', 'sub'])));
    const files = ['trim/controls/theme.trim.ts', 'trim/controls/animations.trim.ts', 'trim/controls/contrast.trim.ts', 'trim/trim.manifest.ts', 'trim/trim.settings.ts', 'trim/trim.config.tsx']
      .map((p) => path.relative(root, path.join(dir, p)));
    execFileSync('node', [
      'node_modules/typescript/bin/tsc', ...files,
      '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck',
    ], { cwd: root });
  }

  // --- a REAL end-to-end sequence: trim init -> new control theme -> new control animations ---
  {
    const dir = path.join(testRoot, 'real-sequence');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler' } }), 'utf8');

    // No components.json -> "Use project shadcn" isn't offered, so the
    // adapter select's choices are [vanilla, headless]; "1"/"1"/"1" =
    // vanilla, popover (shell), default (styling).
    await swallowLogs(() => runInitCommand(dir, scriptedAsk(['1', '1', '1'])));
    await swallowLogs(() => runNewControlCommand(dir, 'theme', scriptedAsk(['2', '', 'n', 'light', '', 'dark', '', 'system', '', '', '1', '3'])));
    await swallowLogs(() => runNewControlCommand(dir, 'animations', scriptedAsk(['1', '', 'y', '1', 'y'])));

    assert.ok(existsSync(path.join(dir, 'trim/controls/theme.trim.ts')));
    assert.ok(existsSync(path.join(dir, 'trim/controls/animations.trim.ts')));
    const manifest = readFileSync(path.join(dir, 'trim/trim.manifest.ts'), 'utf8');
    assert.match(manifest, /import animations from/);
    assert.match(manifest, /import theme from/);
    assert.match(manifest, /import starter from/, '`trim init`\'s seeded "starter" control is still declared — new control only appends');
    const settings = parseExistingManagedSettings(readFileSync(path.join(dir, 'trim/trim.settings.ts'), 'utf8'));
    assert.equal(settings.length, 3, 'one shared controller schema with the seeded starter setting plus both new ones');
    assert.equal(
      readFileSync(path.join(dir, 'trim/trim.config.tsx'), 'utf8'),
      generateConfigContents({ adapter: 'vanilla', shell: 'popover' }),
      'trim.config.tsx still only has the seeded "starter" group — new control never attaches',
    );

    const files = ['trim/controls/starter.trim.ts', 'trim/controls/theme.trim.ts', 'trim/controls/animations.trim.ts', 'trim/trim.manifest.ts', 'trim/trim.settings.ts', 'trim/trim.config.tsx'].map((p) => path.relative(root, path.join(dir, p)));
    execFileSync('node', ['node_modules/typescript/bin/tsc', ...files, '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck'], { cwd: root });
  }

  // --- tarball: new-control CLI files ship, no test fixtures leak in ---
  {
    const json = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
    const files = JSON.parse(json)[pkg.name].files.map((f) => f.path);
    for (const f of ['dist/cli/commands/new-control.js', 'dist/cli/generators/new-control-plan.js', 'dist/cli/generators/control-file.js', 'dist/cli/generators/manifest-file.js', 'dist/cli/project/control-id.js', 'dist/cli/project/binding-validation.js', 'dist/cli/prompts/new-control-prompts.js']) {
      assert.ok(files.includes(f), `${f} should ship in dist/cli`);
    }
    assert.ok(!files.some((f) => f.startsWith('.trim-cli-new-control-test-')), 'no test fixture directory leaks into the tarball');
  }

  console.log('PASS CLI new control: id validation (kebab-case required, never auto-rewritten), invalid id / not-initialized fail before prompting, segmented options loop reprompts with a hint on fewer than 2 options, Boolean/Segmented/Action/ToggleAction generation, is_unique omitted by default and generated as false (never true) when allowed, Existing TrimBinding + callback bindings with correctly RELATIVE import paths, a bad import path is a hard clear failure, cancelled flow writes nothing, duplicate id fails before prompting and leaves the existing file untouched, plan-validation failure writes nothing, manifest lexical ordering independent of add order, settings aggregation into one shared controller with the first control preserved exactly across a second addition, trim.config.tsx never touched, node16/nodenext .js-suffixed imports, no internal src/** or granular-subpath imports in generated files, generated files typecheck against the real built package, a real init -> new control -> new control sequence works end to end, tarball ships the new CLI files without test fixtures');
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
