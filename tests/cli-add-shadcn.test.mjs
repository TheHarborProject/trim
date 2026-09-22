// Tests for `trim add @shadcn/...` (cli/generators/shadcn-registry.ts,
// cli/project/shadcn-config.ts, cli/templates/shadcn/**). See
// cli-add.test.mjs for the "@default/..." refs and @default/example.
//
// Fixtures live inside the repo tree (mkdtempSync under the repo root) —
// generated-file typechecking needs the real dist/ build self-referenced
// by the package's own name, same as every other CLI test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { listShadcnRefs, findShadcnTemplateEntry, SHADCN_TEMPLATE_REGISTRY } = require(path.join(root, 'dist/cli/generators/shadcn-registry.js'));
const { runAddCommand } = require(path.join(root, 'dist/cli/commands/add.js'));
const { runInitCommand } = require(path.join(root, 'dist/cli/commands/init.js'));
const { UsageError } = require(path.join(root, 'dist/cli/dispatch.js'));

const testRoot = mkdtempSync(path.join(root, '.trim-cli-add-shadcn-test-'));

const swallowLogs = async (fn) => {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
};

/** A scripted fake `Prompter` (cli/prompts/prompter.ts) — no TTY/stdin involved. `select()` answers are 1-indexed. */
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

const STUB_COMPONENT_SOURCE = {
  'switch.tsx': `import * as React from "react";
export function Switch(props: { id?: string; checked?: boolean; onCheckedChange?: (checked: boolean) => void; "aria-describedby"?: string }) {
  return React.createElement("button", props);
}
`,
  'toggle-group.tsx': `import * as React from "react";
export function ToggleGroup(props: { type: "single"; value?: string; onValueChange?: (value: string) => void; children?: React.ReactNode }) {
  return React.createElement("div", null, props.children);
}
export function ToggleGroupItem(props: { value: string; children?: React.ReactNode }) {
  return React.createElement("button", null, props.children);
}
`,
  'toggle.tsx': `import * as React from "react";
export function Toggle(props: { pressed?: boolean; onPressedChange?: (pressed: boolean) => void; children?: React.ReactNode }) {
  return React.createElement("button", null, props.children);
}
`,
};

/**
 * A fresh Trim-initialized project (via the real runInitCommand, so
 * trim.json/config/manifest/settings are all real) plus, optionally, a
 * shadcn setup: components.json with the given "ui" alias, a matching
 * tsconfig `paths` entry, and stub component files for whichever
 * `presentComponents` file base names are listed (e.g. ["switch"]) — NOT
 * relying on any shadcn actually installed on the developer's machine, per
 * this step's own "do not rely on the developer machine's own shadcn
 * installation" requirement.
 */
async function shadcnFixture(name, {
  uiAlias = '@/components/ui',
  pathAliasPattern = '@/*',
  pathAliasTarget = './*',
  uiDirRelPath = 'components/ui',
  presentComponents = ['switch.tsx', 'toggle-group.tsx', 'toggle.tsx'],
  componentsJsonContent,
  withShadcn = true,
} = {}) {
  const dir = path.join(testRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { moduleResolution: 'bundler', baseUrl: '.', paths: { [pathAliasPattern]: [pathAliasTarget] } },
  }), 'utf8');
  // No components.json exists yet -> "Use project shadcn" isn't offered, so
  // the adapter select's choices are [vanilla, headless]; "1"/"1"/"1" =
  // vanilla, popover (shell), default (styling).
  await swallowLogs(() => runInitCommand(dir, scriptedAsk(['1', '1', '1'])));

  if (withShadcn) {
    const content = componentsJsonContent ?? JSON.stringify({ aliases: { ui: uiAlias, components: uiAlias.replace(/\/ui$/, ''), utils: uiAlias.replace(/\/ui$/, '/lib/utils') } });
    writeFileSync(path.join(dir, 'components.json'), content, 'utf8');
    mkdirSync(path.join(dir, uiDirRelPath), { recursive: true });
    for (const file of presentComponents) {
      writeFileSync(path.join(dir, uiDirRelPath, file), STUB_COMPONENT_SOURCE[file], 'utf8');
    }
  }
  return dir;
}

try {
  // --- ref registry: every shadcn ref resolves ---
  {
    assert.deepEqual(listShadcnRefs(), ['@shadcn/controls/boolean', '@shadcn/controls/segmented', '@shadcn/controls/toggle-action']);
    for (const ref of listShadcnRefs()) assert.ok(findShadcnTemplateEntry(ref), `${ref} is a known shadcn template`);
    assert.equal(findShadcnTemplateEntry('@shadcn/example'), undefined, 'not implemented this step — narrow scope');
    assert.equal(findShadcnTemplateEntry('@shadcn/layouts/sections'), undefined, 'no shadcn-specific layout — DefaultSectionsLayout-equivalent has no shadcn-specific concern to vary');
  }

  // --- unknown ref lists shadcn refs too ---
  {
    const dir = path.join(testRoot, 'unknown-ref-lists-shadcn');
    mkdirSync(dir, { recursive: true });
    await assert.rejects(runAddCommand(dir, '@bogus/thing'), /@shadcn\/controls\/boolean/, 'the unknown-ref error lists at least one real shadcn ref');
  }

  // --- A. valid shadcn project: each of the 3 refs installs, generated file resolves the configured alias, no runtime shadcn dependency, typechecks ---
  for (const entry of SHADCN_TEMPLATE_REGISTRY) {
    const dir = await shadcnFixture(`valid-${entry.ref.replace(/[@/]/g, '-')}`);
    const output = await swallowLogs(() => runAddCommand(dir, entry.ref));
    assert.match(output, new RegExp(`^\\+ ${entry.targetPath.replace(/[.[\]]/g, '\\$&')}`, 'm'));
    assert.ok(existsSync(path.join(dir, entry.targetPath)));

    const contents = readFileSync(path.join(dir, entry.targetPath), 'utf8');
    assert.match(contents, new RegExp(`from "@/components/ui/${entry.requiredComponent.fileBaseName}"`), 'imports the host\'s actual configured component, not a guessed path');
    assert.match(contents, /@theharborproject\/trim\/react/, 'imports the public Trim renderer contract');
    assert.doesNotMatch(contents, /\bsrc\//, 'no internal src/** path leaks into the generated file');
    assert.doesNotMatch(contents, /shadcn\/ui|@\/lib\/utils|cn\(/, 'no shadcn runtime helper is pulled in — only the host\'s own component import');

    // typechecks against BOTH the real built package AND this fixture's own stub component
    const relFile = path.relative(root, path.join(dir, entry.targetPath));
    const relTsconfigDir = path.relative(root, dir);
    writeFileSync(path.join(dir, 'tsconfig.check.json'), JSON.stringify({
      compilerOptions: { target: 'es2020', module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true, baseUrl: '.', paths: { '@/*': ['./*'] } },
      include: [path.relative(dir, path.join(dir, entry.targetPath))],
    }), 'utf8');
    execFileSync('node', [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.check.json'], { cwd: dir });
    void relFile; void relTsconfigDir;
  }

  // --- B. no shadcn setup at all -> clear failure, nothing written ---
  {
    const dir = await shadcnFixture('no-shadcn', { withShadcn: false });
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), UsageError);
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), /requires a shadcn setup/);
    assert.ok(!existsSync(path.join(dir, 'trim/renderers/shadcn-boolean.tsx')));
  }

  // --- malformed components.json -> clear failure ---
  {
    const dir = await shadcnFixture('malformed-components-json', { withShadcn: false });
    writeFileSync(path.join(dir, 'components.json'), 'not even json', 'utf8');
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), UsageError);
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), /not valid JSON/);
  }

  // --- components.json with no "aliases" object -> clear failure ---
  {
    const dir = await shadcnFixture('no-aliases-object', { withShadcn: false });
    writeFileSync(path.join(dir, 'components.json'), JSON.stringify({ style: 'default' }), 'utf8');
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), UsageError);
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), /no "aliases" object/);
  }

  // --- components.json missing the "ui" alias specifically -> clear failure ---
  {
    const dir = await shadcnFixture('no-ui-alias', { withShadcn: false });
    writeFileSync(path.join(dir, 'components.json'), JSON.stringify({ aliases: { components: '@/components' } }), 'utf8');
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), /no "ui" alias configured/);
  }

  // --- alias not resolvable via tsconfig paths -> clear failure, never guesses ---
  {
    const dir = await shadcnFixture('unresolvable-alias', { pathAliasPattern: '~/*', pathAliasTarget: './lib/*' }); // components.json still says "@/components/ui", which no longer matches any tsconfig path
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), UsageError);
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), /could not resolve the shadcn "ui" alias/);
  }

  // --- C: shadcn configured but the required component is missing -> exact clear failure ---
  {
    const dir = await shadcnFixture('missing-component', { presentComponents: ['toggle-group.tsx', 'toggle.tsx'] }); // switch.tsx deliberately absent
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), UsageError);
    const message = await runAddCommand(dir, '@shadcn/controls/boolean').catch((e) => e.message);
    assert.match(message, /requires the shadcn Switch component/);
    assert.match(message, /Add it first with your shadcn CLI, then re-run:\n {2}trim add @shadcn\/controls\/boolean/);
    assert.ok(!existsSync(path.join(dir, 'trim/renderers/shadcn-boolean.tsx')));
    // the OTHER two, whose components ARE present, still install fine
    await swallowLogs(() => runAddCommand(dir, '@shadcn/controls/segmented'));
    assert.ok(existsSync(path.join(dir, 'trim/renderers/shadcn-segmented.tsx')));
  }

  // --- D: custom alias/path is respected, not the "@/components/ui" convention ---
  {
    const dir = await shadcnFixture('custom-alias', {
      uiAlias: '~/ui',
      pathAliasPattern: '~/*',
      pathAliasTarget: './lib/*',
      uiDirRelPath: 'lib/ui',
    });
    await swallowLogs(() => runAddCommand(dir, '@shadcn/controls/boolean'));
    const contents = readFileSync(path.join(dir, 'trim/renderers/shadcn-boolean.tsx'), 'utf8');
    assert.match(contents, /from "~\/ui\/switch"/, 'the CUSTOM alias is used verbatim, never the "@/components/ui" convention');
  }

  // --- idempotent rerun: byte-identical -> already installed, never rewritten ---
  {
    const dir = await shadcnFixture('idempotent-rerun');
    await swallowLogs(() => runAddCommand(dir, '@shadcn/controls/boolean'));
    const before = readFileSync(path.join(dir, 'trim/renderers/shadcn-boolean.tsx'), 'utf8');
    const output = await swallowLogs(() => runAddCommand(dir, '@shadcn/controls/boolean'));
    assert.match(output, /already installed/);
    assert.equal(readFileSync(path.join(dir, 'trim/renderers/shadcn-boolean.tsx'), 'utf8'), before);
  }

  // --- conflict: a hand-edited installed file is never overwritten ---
  {
    const dir = await shadcnFixture('conflict');
    await swallowLogs(() => runAddCommand(dir, '@shadcn/controls/boolean'));
    const handEdited = readFileSync(path.join(dir, 'trim/renderers/shadcn-boolean.tsx'), 'utf8') + '\n// hand-edited\n';
    writeFileSync(path.join(dir, 'trim/renderers/shadcn-boolean.tsx'), handEdited, 'utf8');
    await assert.rejects(runAddCommand(dir, '@shadcn/controls/boolean'), /already exists with different content/);
    assert.equal(readFileSync(path.join(dir, 'trim/renderers/shadcn-boolean.tsx'), 'utf8'), handEdited, 'never overwritten');
  }

  // --- @default/controls/boolean and trim/renderers/boolean.tsx are UNTOUCHED by installing the shadcn variant — no collision ---
  {
    const dir = await shadcnFixture('default-and-shadcn-coexist');
    await swallowLogs(() => runAddCommand(dir, '@default/controls/boolean'));
    const defaultContents = readFileSync(path.join(dir, 'trim/renderers/boolean.tsx'), 'utf8');
    await swallowLogs(() => runAddCommand(dir, '@shadcn/controls/boolean'));
    assert.equal(readFileSync(path.join(dir, 'trim/renderers/boolean.tsx'), 'utf8'), defaultContents, '@default/controls/boolean is never overwritten by installing @shadcn/controls/boolean');
    assert.ok(existsSync(path.join(dir, 'trim/renderers/shadcn-boolean.tsx')), 'the shadcn variant installs alongside it, at a distinct path');
  }

  // --- trim.json's persisted shadcn preference never changes explicit-ref behavior, in either direction ---
  {
    // shadcn: false persisted, but a real shadcn setup exists -> @shadcn/... still installs
    const dirA = await shadcnFixture('trimjson-false-does-not-block');
    const metaPath = path.join(dirA, 'trim/trim.json');
    assert.match(readFileSync(metaPath, 'utf8'), /"shadcn": false/);
    await swallowLogs(() => runAddCommand(dirA, '@shadcn/controls/boolean'));
    assert.ok(existsSync(path.join(dirA, 'trim/renderers/shadcn-boolean.tsx')), 'trim.json shadcn:false does not block an explicit @shadcn ref when the host actually has a valid setup');

    // shadcn: true persisted (simulate by hand-editing trim.json) never changes @default/... behavior
    const dirB = await shadcnFixture('trimjson-true-does-not-affect-default');
    writeFileSync(path.join(dirB, 'trim/trim.json'), JSON.stringify({ version: 1, shadcn: true, styling: 'default' }, null, 2) + '\n', 'utf8');
    const output = await swallowLogs(() => runAddCommand(dirB, '@default/controls/boolean'));
    assert.doesNotMatch(output.toLowerCase(), /shadcn/, '@default/controls/boolean never mentions or varies behavior for shadcn, regardless of trim.json');
    const contents = readFileSync(path.join(dirB, 'trim/renderers/boolean.tsx'), 'utf8');
    assert.doesNotMatch(contents, /shadcn/i, 'the installed @default file has no shadcn involvement at all');
  }

  // --- runtime src/** has zero shadcn references/imports of any kind ---
  {
    function listFiles(dir, re) {
      const out = [];
      for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(full, re));
        else if (re.test(entry.name)) out.push(full);
      }
      return out;
    }
    // Comments legitimately NAME "shadcn" to explain that a file is
    // deliberately unaware of it (e.g. "knows nothing about shadcn or any
    // other host concern") — the same false-positive shape example.test.mjs
    // and panel.test.mjs already strip comments to avoid. This check is
    // about actual code (imports/identifiers), not prose.
    const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const file of listFiles(path.join(root, 'src'), /\.(ts|tsx)$/)) {
      const source = stripComments(readFileSync(file, 'utf8'));
      assert.doesNotMatch(source, /shadcn/i, `${path.relative(root, file)} must not reference shadcn in actual code — the Trim runtime is completely unaware it exists`);
    }
    // the built runtime entry points too, not just source
    for (const distFile of ['dist/core/index.js', 'dist/react/index.js', 'dist/advanced/index.js']) {
      const source = stripComments(readFileSync(path.join(root, distFile), 'utf8'));
      assert.doesNotMatch(source, /shadcn/i, `${distFile} must not reference shadcn`);
    }
  }

  // --- tarball: dist/cli/templates/shadcn/** ships; raw cli/templates/shadcn/** source never does ---
  {
    const json = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: root, encoding: 'utf8' });
    const files = JSON.parse(json)[pkg.name].files.map((f) => f.path);
    assert.ok(files.includes('dist/cli/generators/shadcn-registry.js'));
    assert.ok(files.includes('dist/cli/project/shadcn-config.js'));
    for (const entry of SHADCN_TEMPLATE_REGISTRY) {
      assert.ok(files.includes(`dist/cli/templates/${entry.templatePath}`), `dist/cli/templates/${entry.templatePath} ships`);
    }
    assert.ok(!files.some((f) => f.startsWith('cli/')), 'raw cli/** source never ships');
    assert.ok(!files.some((f) => f.startsWith('.trim-cli-add-shadcn-test-')), 'no test fixture directory leaks into the tarball');
  }

  // --- template lookup works from an ACTUAL packed-and-extracted tarball ---
  {
    const packDir = mkdtempSync(path.join(testRoot, 'pack-'));
    const tarballName = execFileSync('npm', ['pack', '--silent', '--pack-destination', packDir], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop();
    const extractDir = path.join(packDir, 'extracted');
    mkdirSync(extractDir, { recursive: true });
    execFileSync('tar', ['xzf', path.join(packDir, tarballName), '-C', extractDir]);
    const installedBin = path.join(extractDir, 'package/dist/cli/bin/trim.js');
    assert.ok(existsSync(installedBin));

    const consumerDir = path.join(packDir, 'consumer');
    mkdirSync(path.join(consumerDir, 'components/ui'), { recursive: true });
    writeFileSync(path.join(consumerDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { moduleResolution: 'bundler', baseUrl: '.', paths: { '@/*': ['./*'] } } }), 'utf8');
    writeFileSync(path.join(consumerDir, 'components.json'), JSON.stringify({ aliases: { ui: '@/components/ui' } }), 'utf8');
    writeFileSync(path.join(consumerDir, 'components/ui/switch.tsx'), STUB_COMPONENT_SOURCE['switch.tsx'], 'utf8');
    // this consumer never ran `trim init` — buildShadcnTemplatePlan doesn't require it (only the generated file's target directory), proving the shadcn path resolves independent of the init/example machinery
    execFileSync('node', [installedBin, 'add', '@shadcn/controls/boolean'], { cwd: consumerDir });
    const installedFile = readFileSync(path.join(consumerDir, 'trim/renderers/shadcn-boolean.tsx'), 'utf8');
    assert.match(installedFile, /from "@\/components\/ui\/switch"/, 'resolved from the packed-and-extracted package\'s OWN dist/cli/templates, not a repo-relative dev path');
  }

  console.log('PASS CLI add (shadcn): ref registry (3 refs resolve, no @shadcn/example or @shadcn/layouts/sections this step, unknown-ref error lists shadcn refs too), valid shadcn project installs all 3 with the host\'s actual configured alias/no runtime shadcn dependency/typechecks against the fixture\'s own stub component, no shadcn setup / malformed components.json / missing "aliases" / missing "ui" alias / unresolvable alias all fail clearly with nothing written, missing required component fails with the exact "requires the shadcn X component" message while unaffected refs still install, custom alias/path is respected verbatim, idempotent rerun, conflict never overwritten, @default and @shadcn variants coexist without collision, trim.json\'s persisted shadcn preference never changes either explicit ref\'s behavior in either direction, src/** and the built runtime entry points have zero shadcn references, tarball ships dist/cli/templates/shadcn/** but never raw source, and template lookup works from an actual packed-and-extracted tarball');
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
