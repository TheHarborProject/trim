// Tests for the CLI skeleton (cli/dispatch.ts + cli/commands/*.ts +
// cli/bin/trim.ts): parsing, help, unknown-command handling, exit codes,
// and the package/build boundary between runtime and CLI. This file tests
// DISPATCH mechanics only — `init`, `new control`, `attach`, `add`, and now
// `detect` all have real behavior (project detection, interactive prompts,
// static analysis, file generation/editing/template installation; see
// cli-init.test.mjs, cli-new-control.test.mjs, cli-attach.test.mjs,
// cli-add.test.mjs, cli-detect.test.mjs), so the dispatch table below uses
// fake handlers for all five here, exactly the way a real command handler
// is exercised, without pulling stdin or the filesystem into a test about
// parsing.
//
// Runs the REAL `npm run build` (both tsconfig.json and tsconfig.cli.json),
// like package-exports.test.mjs and example.test.mjs — this file is about
// the actual build/package boundary, not a slice of src/cli compiled ad hoc.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });

const require = createRequire(import.meta.url);

// --- shebang + executable bit on the built bin ---
{
  const binPath = path.join(root, 'dist/cli/bin/trim.js');
  const firstLine = readFileSync(binPath, 'utf8').split('\n')[0];
  assert.equal(firstLine, '#!/usr/bin/env node');
  const mode = statSync(binPath).mode;
  assert.ok(mode & 0o111, 'the built bin is executable (owner/group/other exec bit set)');
  assert.equal(pkg.bin.trim, './dist/cli/bin/trim.js');
}

// --- dispatch: help, no args, unknown command, each command's parsing ---
{
  const { runCli, UsageError } = require(path.join(root, 'dist/cli/dispatch.js'));
  // Fake — dispatch mechanics only, per this file's header. init's,
  // new-control's, attach's, add's, and detect's real handlers are
  // exercised in cli-init.test.mjs, cli-new-control.test.mjs,
  // cli-attach.test.mjs, cli-add.test.mjs, and cli-detect.test.mjs
  // respectively. Each fake replicates only its real handler's own outer
  // shell (a genuine dispatch/argument-parsing concern this file is meant
  // to cover) — the deeper project-detection/prompting/scanning/
  // installation behavior is faked away.
  const fakeInitCommand = async () => { console.log('fake init dispatched'); };
  const fakeAddCommand = async (args) => {
    const [ref] = args;
    if (!ref) throw new UsageError('Usage: trim add <ref>');
    console.log(`fake add dispatched: ${ref}`);
  };
  const fakeDetectCommand = async () => { console.log('fake detect dispatched'); };
  const fakeNewControlCommand = async (args) => {
    const [id] = args;
    if (!id) throw new UsageError('Usage: trim new control <id>');
    console.log(`fake new-control dispatched: ${id}`);
  };
  const fakeAttachCommand = async (args) => {
    const [id] = args;
    if (!id) throw new UsageError('Usage: trim attach <control-id>');
    console.log(`fake attach dispatched: ${id}`);
  };
  const commands = { init: fakeInitCommand, add: fakeAddCommand, detect: fakeDetectCommand, 'new-control': fakeNewControlCommand, attach: fakeAttachCommand };

  const captured = { out: [], err: [] };
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const originalLog = console.log;
  process.stdout.write = (chunk) => { captured.out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { captured.err.push(String(chunk)); return true; };
  console.log = (...args) => { captured.out.push(args.join(' ') + '\n'); };
  const reset = () => { captured.out.length = 0; captured.err.length = 0; };
  const restore = () => { process.stdout.write = originalOut; process.stderr.write = originalErr; console.log = originalLog; };

  try {
    // --help
    reset();
    assert.equal(await runCli(['--help'], commands), 0);
    assert.match(captured.out.join(''), /Usage:\s*\n\s*trim <command>/);
    assert.deepEqual(captured.err, []);

    // no args -> same help, same exit code
    reset();
    assert.equal(await runCli([], commands), 0);
    assert.match(captured.out.join(''), /Trim\n/);

    // -h / help word, same behavior
    for (const flag of ['-h', 'help']) {
      reset();
      assert.equal(await runCli([flag], commands), 0);
      assert.match(captured.out.join(''), /Usage:/);
    }

    // unknown command
    reset();
    assert.equal(await runCli(['bogus'], commands), 1);
    assert.match(captured.err.join(''), /unknown command "bogus"/);
    assert.match(captured.err.join(''), /Usage:/, 'help is shown alongside the error');

    // init: dispatches to whatever "init" maps to, exit 0 (real behavior tested in cli-init.test.mjs)
    reset();
    assert.equal(await runCli(['init'], commands), 0);
    assert.match(captured.out.join(''), /fake init dispatched/);

    // add: usage error without a ref
    reset();
    assert.equal(await runCli(['add'], commands), 1);
    assert.match(captured.err.join(''), /Usage: trim add <ref>/);

    // add: dispatches with the ref (real behavior tested in cli-add.test.mjs)
    reset();
    assert.equal(await runCli(['add', '@default/example'], commands), 0);
    assert.match(captured.out.join(''), /fake add dispatched: @default\/example/);

    // detect: dispatches (real behavior tested in cli-detect.test.mjs)
    reset();
    assert.equal(await runCli(['detect'], commands), 0);
    assert.match(captured.out.join(''), /fake detect dispatched/);

    // new control: the nested two-token command name parses correctly
    reset();
    assert.equal(await runCli(['new', 'control'], commands), 1, 'missing id is a usage error, not "unknown command new"');
    assert.match(captured.err.join(''), /Usage: trim new control <id>/);

    reset();
    assert.equal(await runCli(['new', 'control', 'reduced-motion'], commands), 0);
    assert.match(captured.out.join(''), /fake new-control dispatched: reduced-motion/);

    // "new" alone (no "control") is correctly an unknown command, not a crash
    reset();
    assert.equal(await runCli(['new'], commands), 1);
    assert.match(captured.err.join(''), /unknown command "new"/);

    // attach: usage error without an id, dispatches with one
    reset();
    assert.equal(await runCli(['attach'], commands), 1);
    assert.match(captured.err.join(''), /Usage: trim attach <control-id>/);

    reset();
    assert.equal(await runCli(['attach', 'reduced-motion'], commands), 0);
    assert.match(captured.out.join(''), /fake attach dispatched: reduced-motion/);
  } finally {
    restore();
  }
}

// --- the bin itself, invoked as a real subprocess (proves the whole ---
// --- chain: shebang, exit code, argv plumbing — not just the JS API) ---
{
  const binPath = path.join(root, 'dist/cli/bin/trim.js');
  const run = (args) => {
    try {
      const stdout = execFileSync('node', [binPath, ...args], { encoding: 'utf8' });
      return { code: 0, stdout };
    } catch (e) {
      return { code: e.status, stdout: e.stdout, stderr: e.stderr };
    }
  };
  assert.equal(run(['--help']).code, 0);
  assert.match(run(['--help']).stdout, /Usage:/);
  assert.equal(run(['bogus']).code, 1);
  // Not `init`, `new control <id>`, or `attach <id>`, here: all now do real
  // project detection and interactive prompting/editing (cli-init.test.mjs,
  // cli-new-control.test.mjs, cli-attach.test.mjs, cli-detect.test.mjs),
  // which would run against this subprocess's own inherited stdin/cwd (this
  // repo's own root, which has no trim/trim.json). `new control`/`attach`
  // with NO id are safe here regardless: the missing-id check happens
  // before any project/filesystem access. `detect` takes no argument to
  // check first, but its OWN first real step — reading trim/trim.json — is
  // exactly the same "not initialized" failure, real and safe to assert on
  // through a real subprocess against this repo's own (uninitialized) root.
  assert.equal(run(['detect']).code, 1, 'not initialized via the real subprocess too');
  assert.match(run(['detect']).stderr, /this project is not initialized/);
  assert.equal(run(['new', 'control']).code, 1, 'missing id via the real subprocess too');
  assert.equal(run(['attach']).code, 1, 'attach missing id via the real subprocess too');
}

// --- Ctrl+C during a prompt (dispatch.ts's ExitPromptError handling): the ---
// --- real binary, a real prompt, genuinely non-interactive (piped, ---
// --- non-TTY) stdin — @inquirer/prompts requires a real terminal, so the ---
// --- very first prompt rejects with ExitPromptError as soon as stdin ---
// --- closes, exactly as a real Ctrl+C would reject it. This proves ---
// --- dispatch.ts's catch turns that into a clean "Trim cancelled." and ---
// --- exit code 0 (the same convention an explicit in-menu Cancel choice ---
// --- already uses) instead of a crash with a stack trace. ---
{
  const binPath = path.join(root, 'dist/cli/bin/trim.js');
  const cancelTestRoot = mkdtempSync(path.join(root, '.trim-cli-cancel-test-'));
  try {
    const dir = path.join(cancelTestRoot, 'project');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'tsconfig.json'), '{}', 'utf8');
    const result = execFileSync('node', [binPath, 'init'], { cwd: dir, input: '', encoding: 'utf8' });
    assert.match(result, /Trim cancelled\./, 'ExitPromptError from a non-interactive stdin is caught and printed cleanly');
    assert.doesNotMatch(result, /at Object|at async|\.js:\d+:\d+/, 'no stack trace leaks through for this expected cancellation');
  } finally {
    rmSync(cancelTestRoot, { recursive: true, force: true });
  }
}

// --- no runtime coupling: nothing under src/ references cli/, and none of ---
// --- the built runtime files mention it either ---
{
  function listFiles(dir, re) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...listFiles(full, re));
      else if (re.test(entry.name)) out.push(full);
    }
    return out;
  }
  for (const file of listFiles(path.join(root, 'src'), /\.(ts|tsx)$/)) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /from\s+["'][^"']*\bcli\b[^"']*["']/, `${path.relative(root, file)} must not import from cli/`);
  }
  for (const runtimeDir of ['dist/core', 'dist/react', 'dist/advanced']) {
    for (const file of listFiles(path.join(root, runtimeDir), /\.js$/)) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /require\(["'][^"']*\bcli\b[^"']*["']\)/, `${path.relative(root, file)} must not require anything from cli/`);
    }
  }
}

// --- tarball: dist/cli/** ships, raw cli/** source does not ---
{
  const json = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
  const files = JSON.parse(json)[pkg.name].files.map(f => f.path);
  assert.ok(files.includes('dist/cli/bin/trim.js'));
  assert.ok(files.includes('dist/cli/dispatch.js'));
  assert.ok(!files.some(f => f.startsWith('cli/')), 'raw cli/ source must never appear in the publishable tarball');
}

console.log('PASS CLI skeleton: shebang + executable bit on the built bin, dispatch (help/no-args/-h/unknown command/each command\'s parsing incl. the nested "new control" name and its own missing-arg usage error), the same behavior reproduced through the real subprocess, Ctrl+C/ExitPromptError from a real prompt under non-interactive stdin is caught and printed as a clean "Trim cancelled." with exit code 0 (never a crash), no runtime file references cli/ (source or built), tarball ships dist/cli/** but never raw cli/ source');
