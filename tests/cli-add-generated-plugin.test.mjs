import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
const require = createRequire(import.meta.url);
const { runAddCommand } = require('../dist/cli/commands/add.js');
const { runInitCommand } = require('../dist/cli/commands/init.js');
const { GENERATED_PLUGINS, buildGeneratedPluginPlan, applyGeneratedPluginPlan } = require('../dist/cli/generators/generated-plugin-plan.js');
const { generateControlFileContents } = require('../dist/cli/generators/control-file.js');
const { generateSettingsFileContents, parseExistingManagedSettings } = require('../dist/cli/generators/settings-file.js');
const { UsageError } = require('../dist/cli/dispatch.js');
const ref = '@default/plugins/text-size';
const testRoot = fs.mkdtempSync(path.join(root, '.trim-cli-plugin-test-'));
const originalLog = console.log;
console.log = () => {};
let counter = 0;
const configPath = 'trim/trim.config.tsx';
const settingsPath = 'trim/trim.settings.ts';
const manifestPath = 'trim/trim.manifest.ts';
const controlPath = 'trim/controls/text-size.trim.ts';
const canonical = {
  id: 'text-size', kind: 'segmented', label: 'Text size', allowMultiple: false,
  options: [{ value: 'small', label: 'A' }, { value: 'default', label: 'A' }, { value: 'large', label: 'A' }],
  binding: { mode: 'trim-managed', defaultValue: 'default' },
};
function read(dir, file) { return fs.readFileSync(path.join(dir, file), 'utf8'); }
function write(dir, file, text) { fs.writeFileSync(path.join(dir, file), text); }
function tree(dir) {
  const result = {};
  function walk(current, prefix = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const key = prefix + entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { result[key + '/'] = 'directory'; walk(full, key + '/'); }
      else result[key] = entry.isSymbolicLink() ? `link:${fs.readlinkSync(full)}` : fs.readFileSync(full).toString('base64');
    }
  }
  walk(dir);
  return result;
}
async function fixture(mode = 'bundler', headless = false) {
  const dir = path.join(testRoot, String(counter++));
  fs.mkdirSync(dir);
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { moduleResolution: mode } }));
  const choices = headless ? [1] : [0, 0, 0];
  await runInitCommand(dir, {
    select: async ({ choices: options }) => options[choices.shift()].value,
    confirm: async () => false,
    input: async () => { throw new Error('unexpected input'); },
  });
  return dir;
}
async function refuses(mutator, pattern) {
  const dir = await fixture();
  await mutator(dir);
  const before = tree(dir);
  await assert.rejects(runAddCommand(dir, ref), pattern);
  assert.deepEqual(tree(dir), before, 'failed install must leave the entire project unchanged');
}
try {
  assert.deepEqual(GENERATED_PLUGINS[0].control, canonical);
  for (const mode of ['bundler', 'node16', 'nodenext']) {
    const dir = await fixture(mode, mode === 'nodenext');
    const before = tree(dir);
    const oldConfig = read(dir, configPath);
    const oldSettings = parseExistingManagedSettings(read(dir, settingsPath));
    const plan = await buildGeneratedPluginPlan(dir, GENERATED_PLUGINS[0]);
    assert.deepEqual(tree(dir), before, 'planning is read-only');
    assert.equal(plan.files.length, 4);
    await runAddCommand(dir, ref);
    assert.equal(read(dir, controlPath), generateControlFileContents(canonical, mode === 'bundler' ? 'classic-or-bundler' : 'node16-or-nodenext'));
    assert.deepEqual(parseExistingManagedSettings(read(dir, settingsPath)), [...oldSettings, {
      key: 'text-size', kind: 'segmented', options: ['small', 'default', 'large'], defaultValue: 'default',
    }]);
    assert.match(read(dir, manifestPath), /text-size/);
    assert.match(read(dir, manifestPath), /starter/);
    const config = read(dir, configPath);
    assert.match(config, /id: "text"/);
    assert.match(config, /label: "Text"/);
    assert.match(config, /controls: \[\s*"text-size",?\s*\]/);
    assert.match(config, /controls: \["starter"\]/);
    assert.ok(config.includes(oldConfig.slice(0, oldConfig.indexOf('groups:'))), 'host imports and config prefix preserved');
    for (const [file, contents] of Object.entries(before)) {
      if (![configPath, settingsPath, manifestPath].includes(file)) assert.equal(tree(dir)[file], contents, file);
    }
    const installed = tree(dir);
    await assert.rejects(runAddCommand(dir, ref), /already exists/);
    assert.deepEqual(tree(dir), installed, 'repeat install safely refuses without changes');
    execFileSync('node', ['node_modules/typescript/bin/tsc', path.join(dir, configPath), path.join(dir, controlPath),
      '--noEmit', '--strict', '--module', mode === 'bundler' ? 'esnext' : mode,
      '--moduleResolution', mode, '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck'], { cwd: root, stdio: 'pipe' });
  }
  await refuses((d) => fs.unlinkSync(path.join(d, 'trim/trim.json')), /trim init/);
  await refuses((d) => fs.unlinkSync(path.join(d, configPath)), /trim init/);
  await refuses((d) => write(d, configPath, 'export default getConfig();'), /cannot safely edit/);
  await refuses((d) => write(d, configPath, read(d, configPath).replace('id: "starter"', 'id: "text"')), /group.*already exists/);
  await refuses((d) => write(d, configPath, read(d, configPath).replace('["starter"]', '["starter", "text-size"]')), /already attached/);
  await refuses((d) => write(d, controlPath, '// host declaration'), /already exists/);
  await refuses((d) => write(d, settingsPath, '// @trim-managed-schema invalid JSON'), UsageError);
  await refuses((d) => write(d, settingsPath, generateSettingsFileContents([
    ...parseExistingManagedSettings(read(d, settingsPath)),
    { key: 'text-size', kind: 'boolean', defaultValue: true },
  ])), /already has.*text-size/);
  await refuses((d) => { fs.unlinkSync(path.join(d, manifestPath)); fs.mkdirSync(path.join(d, manifestPath)); }, /regular file/);
  await refuses((d) => fs.symlinkSync('missing.ts', path.join(d, controlPath)), /regular file/);
  // Stale plans must not overwrite intervening edits to ANY affected file.
  for (const file of [controlPath, manifestPath, settingsPath, configPath]) {
    const dir = await fixture();
    const plan = await buildGeneratedPluginPlan(dir, GENERATED_PLUGINS[0]);
    write(dir, file, '// concurrent change');
    const before = tree(dir);
    await assert.rejects(applyGeneratedPluginPlan(dir, plan), /changed during plugin planning/);
    assert.deepEqual(tree(dir), before);
  }
  // Inject a partial write failure at each existing target, after prior files
  // have already been changed. Rollback must restore all bytes and remove control.
  for (const target of [manifestPath, settingsPath, configPath]) {
    const dir = await fixture();
    const before = tree(dir);
    const originalWrite = promises.writeFile;
    let failed = false;
    promises.writeFile = async (file, ...args) => {
      if (!failed && file === path.join(dir, target)) {
        failed = true;
        await originalWrite(file, 'partial write');
        throw new Error('injected write failure');
      }
      return originalWrite(file, ...args);
    };
    try { await assert.rejects(runAddCommand(dir, ref), /injected write failure/); }
    finally { promises.writeFile = originalWrite; }
    assert.ok(failed);
    assert.deepEqual(tree(dir), before, `rollback after ${target}`);
  }
  // Actual CLI dispatch and discoverability, with no prompts or network.
  const dir = await fixture();
  const output = execFileSync('node', [path.join(root, 'dist/cli/bin/trim.js'), 'add', ref], { cwd: dir, encoding: 'utf8' });
  assert.match(output, /Text size installed in Text/);
  await assert.rejects(runAddCommand(dir, '@default/plugins/unknown'), /@default\/plugins\/text-size/);
} finally {
  console.log = originalLog;
  fs.rmSync(testRoot, { recursive: true, force: true });
}
console.log('PASS generated text-size plugin: canonical generators, attach, preservation, module modes, read-only preflight failures, stale plans, rollback, CLI dispatch');
