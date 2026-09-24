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
const { toManagedSetting } = require('../dist/cli/generators/new-control-plan.js');
const { generateSettingsFileContents, parseExistingManagedSettings } = require('../dist/cli/generators/settings-file.js');
const { UsageError } = require('../dist/cli/dispatch.js');

const testRoot = fs.mkdtempSync(path.join(root, '.trim-cli-plugin-test-'));
const originalLog = console.log;
console.log = () => {};
let counter = 0;
const configPath = 'trim/trim.config.tsx';
const settingsPath = 'trim/trim.settings.ts';
const manifestPath = 'trim/trim.manifest.ts';

const textSize = {
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
async function refuses(ref, mutator, pattern) {
  const dir = await fixture();
  await mutator(dir);
  const before = tree(dir);
  await assert.rejects(runAddCommand(dir, ref), pattern);
  assert.deepEqual(tree(dir), before, 'failed install must leave the entire project unchanged');
}
try {
  for (const [canonical, group, setting, rendererSymbol] of [
    [textSize, { id: 'text', label: 'Text' }, { key: 'text-size', kind: 'segmented', options: ['small', 'default', 'large'], defaultValue: 'default' }, 'DefaultSegmentedControlOverride'],
    [{ id: 'high-contrast', kind: 'toggle', label: 'High contrast', allowMultiple: false, binding: { mode: 'trim-managed', defaultValue: false } },
      { id: 'contrast', label: 'Contrast' }, { key: 'high-contrast', kind: 'boolean', defaultValue: false }, 'DefaultBooleanControl'],
  ]) {
    const ref = `@default/plugins/${canonical.id}`;
    const controlPath = `trim/controls/${canonical.id}.trim.ts`;
    const plugin = GENERATED_PLUGINS.find((entry) => entry.ref === ref);
    assert.deepEqual(plugin.control, canonical);
    assert.deepEqual(plugin.group, group);
    for (const mode of ['bundler', 'node16', 'nodenext']) {
      const dir = await fixture(mode, mode === 'nodenext');
      const before = tree(dir);
      const oldConfig = read(dir, configPath);
      const oldSettings = parseExistingManagedSettings(read(dir, settingsPath));
      const installOptions = mode === 'nodenext' ? { renderer: `vanilla.${canonical.kind}` } : {};
      if (mode === 'nodenext') {
        await assert.rejects(runAddCommand(dir, ref), (error) =>
          error.message.includes(`no renderer for control kind "${canonical.kind}"`) &&
          error.message.includes(`--renderer vanilla.${canonical.kind}`));
        const incompatibleRenderer = canonical.kind === 'toggle' ? 'vanilla.segmented' : 'vanilla.toggle';
        await assert.rejects(runAddCommand(dir, ref, { renderer: incompatibleRenderer }), /cannot render control kind/);
        assert.deepEqual(tree(dir), before, 'renderer refusals must not write');
      }
      const plan = await buildGeneratedPluginPlan(dir, plugin, installOptions);
      assert.deepEqual(tree(dir), before, 'planning is read-only');
      assert.equal(plan.files.length, 4);
      await runAddCommand(dir, ref, installOptions);
      const moduleResolution = mode === 'bundler' ? 'classic-or-bundler' : 'node16-or-nodenext';
      assert.equal(read(dir, controlPath), generateControlFileContents(canonical, moduleResolution));
      if (canonical.kind === 'toggle') {
        const legacyDeclaration = { ...canonical, kind: 'boolean' };
        assert.equal(read(dir, controlPath), generateControlFileContents(legacyDeclaration, moduleResolution),
          'semantic toggle and historical boolean declarations produce byte-identical source');
        assert.deepEqual(toManagedSetting(canonical), toManagedSetting(legacyDeclaration),
          'semantic control kind does not change the boolean settings schema');
        assert.match(read(dir, controlPath), /export default defineBooleanControl\(/);
      }
      assert.deepEqual(parseExistingManagedSettings(read(dir, settingsPath)), [...oldSettings, setting].sort((a, b) => a.key.localeCompare(b.key)));
      assert.ok(read(dir, manifestPath).includes(canonical.id));
      assert.match(read(dir, manifestPath), /starter/);
      const config = read(dir, configPath);
      assert.ok(config.includes(`id: "${group.id}"`));
      assert.ok(config.includes(`label: "${group.label}"`));
      if (mode === 'nodenext') assert.ok(config.includes(`{ id: "${canonical.id}", component: ${rendererSymbol} }`));
      else {
        assert.ok(config.includes(`"${canonical.id}"`));
        assert.doesNotMatch(config, /component:/);
      }
      assert.match(config, /controls: \["starter"\]/);
      if (mode !== 'nodenext') assert.ok(config.includes(oldConfig.slice(0, oldConfig.indexOf('groups:'))), 'host imports and config prefix preserved');
      for (const [file, contents] of Object.entries(before)) {
        if (![configPath, settingsPath, manifestPath].includes(file)) assert.equal(tree(dir)[file], contents, file);
      }
      const installed = tree(dir);
      await assert.rejects(runAddCommand(dir, ref, installOptions), /already exists/);
      assert.deepEqual(tree(dir), installed, 'repeat install safely refuses without changes');
      execFileSync('node', ['node_modules/typescript/bin/tsc', path.join(dir, configPath), path.join(dir, controlPath),
        '--noEmit', '--strict', '--module', mode === 'bundler' ? 'esnext' : mode,
        '--moduleResolution', mode, '--target', 'es2020', '--jsx', 'react-jsx', '--skipLibCheck'], { cwd: root, stdio: 'pipe' });
      const outputDir = path.join(dir, 'compiled');
      execFileSync('node', ['node_modules/typescript/bin/tsc', path.join(dir, manifestPath),
        '--rootDir', path.join(dir, 'trim'), '--outDir', outputDir, '--module', 'node16', '--moduleResolution', 'node16',
        '--target', 'es2020', '--skipLibCheck'], { cwd: root, stdio: 'pipe' });
      const control = require(path.join(outputDir, 'controls', `${canonical.id}.trim.js`)).default;
      assert.equal(control.id, canonical.id);
      assert.equal(control.label, canonical.label);
      assert.equal(control.kind, plugin.control.kind);
      assert.equal(control.binding.get(), setting.defaultValue);
    }
    await refuses(ref, (d) => fs.unlinkSync(path.join(d, 'trim/trim.json')), /trim init/);
    await refuses(ref, (d) => fs.unlinkSync(path.join(d, configPath)), /trim init/);
    await refuses(ref, (d) => write(d, configPath, 'export default getConfig();'), /cannot safely edit/);
    await refuses(ref, (d) => write(d, configPath, read(d, configPath).replace('id: "starter"', `id: "${group.id}"`)), /group.*already exists/);
    await refuses(ref, (d) => write(d, configPath, read(d, configPath).replace('["starter"]', `["starter", "${canonical.id}"]`)), /already attached/);
    await refuses(ref, (d) => write(d, controlPath, '// host declaration'), /already exists/);
    await refuses(ref, (d) => write(d, settingsPath, '// @trim-managed-schema invalid JSON'), UsageError);
    await refuses(ref, (d) => write(d, settingsPath, generateSettingsFileContents([
      ...parseExistingManagedSettings(read(d, settingsPath)),
      { key: canonical.id, kind: 'boolean', defaultValue: true },
    ])), /already has/);
    await refuses(ref, (d) => { fs.unlinkSync(path.join(d, manifestPath)); fs.mkdirSync(path.join(d, manifestPath)); }, /regular file/);
    await refuses(ref, (d) => fs.symlinkSync('missing.ts', path.join(d, controlPath)), /regular file/);
    // Stale plans must not overwrite intervening edits to ANY affected file.
    for (const file of [controlPath, manifestPath, settingsPath, configPath]) {
      const dir = await fixture();
      const plan = await buildGeneratedPluginPlan(dir, plugin);
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
    assert.ok(output.includes(`${canonical.label} installed in ${group.label}`));
    await assert.rejects(runAddCommand(dir, '@default/plugins/unknown'), (error) => error.message.includes(ref));
  }
} finally {
  console.log = originalLog;
  fs.rmSync(testRoot, { recursive: true, force: true });
}
console.log('PASS generated text-size and high-contrast plugins: canonical generators, attach, preservation, module modes, read-only preflight failures, stale plans, rollback, CLI dispatch');
