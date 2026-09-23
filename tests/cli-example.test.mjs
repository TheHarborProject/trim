import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

const root = path.join(import.meta.dirname, '..');
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });
const require = createRequire(import.meta.url);
const { RegistryClient, parseRegistryManifest, resolveExample, DEFAULT_REGISTRY_URL } = require(path.join(root, 'dist/cli/registry/client.js'));
const { buildRegistryExamplePlan, applyRegistryExamplePlan } = require(path.join(root, 'dist/cli/generators/example-plan.js'));
const { runExampleCommand } = require(path.join(root, 'dist/cli/commands/example.js'));
const bin = path.join(root, 'dist/cli/bin/trim.js');
const execute = promisify(execFile);
const scratch = await mkdtemp(path.join(tmpdir(), 'trim-registry-test-'));
const bytes = Buffer.from([0, 255, 128, 13, 10]);
const manifest = {
  version: 1, styles: { ignored: true },
  examples: {
    vanilla: { path: 'examples/vanilla', description: 'fixture', files: ['package.json', 'app/page.tsx', '.gitignore', 'public/a #%.bin'] },
    headless: { path: 'examples/headless', files: [] },
  },
};
const source = JSON.stringify(manifest);
const parsed = parseRegistryManifest(source);
assert.equal(DEFAULT_REGISTRY_URL, 'https://theharborproject.github.io/trim-registry/registry/registry.json');
assert.deepEqual(resolveExample(parsed, 'vanilla'), { path: 'examples/vanilla', files: manifest.examples.vanilla.files });
assert.throws(() => resolveExample(parsed, 'unknown'), /Unknown example "unknown".*headless, vanilla/);
assert.throws(() => resolveExample(parsed, 'constructor'), /Unknown example/);
for (const bad of ['not json', 'null', '{}', '{"examples":[]}', '{"examples":{"x":{"path":"examples/x"}}}']) {
  assert.throws(() => parseRegistryManifest(bad), /Invalid registry/);
}
for (const invalid of ['../outside', '/absolute', 'a/../../b', 'a\\b', 'https://evil/file', 'a//b', 'a/./b']) {
  assert.throws(() => parseRegistryManifest(JSON.stringify({ examples: { x: { path: invalid, files: [] } } })), /Invalid registry path/);
  assert.throws(() => parseRegistryManifest(JSON.stringify({ examples: { x: { path: 'examples/x', files: [invalid] } } })), /Invalid registry path/);
}
for (const files of [['a', 'a'], ['a/b', 'a'], [1]]) {
  assert.throws(() => parseRegistryManifest(JSON.stringify({ examples: { x: { path: 'examples/x', files } } })), /registry (file|path)/);
}
assert.throws(() => new RegistryClient('ftp://example.org/registry.json'), /HTTP\(S\)/);
let server;
try {
  const registryDir = path.join(scratch, 'registry');
  const exampleDir = path.join(registryDir, 'examples/vanilla');
  await mkdir(path.join(exampleDir, 'app'), { recursive: true });
  await mkdir(path.join(exampleDir, 'public'));
  await writeFile(path.join(registryDir, 'registry.json'), source);
  await writeFile(path.join(exampleDir, 'package.json'), '{"scripts":{"postinstall":"exit 99"}}');
  await writeFile(path.join(exampleDir, 'app/page.tsx'), 'export default function Page() {}\n');
  await writeFile(path.join(exampleDir, '.gitignore'), 'node_modules\n');
  await writeFile(path.join(exampleDir, 'public/a #%.bin'), bytes);
  await writeFile(path.join(exampleDir, 'unlisted.txt'), 'must not copy');
  const url = pathToFileURL(path.join(registryDir, 'registry.json')).href;
  const client = new RegistryClient(url);
  assert.deepEqual(await client.manifest(), parsed);
  const files = await client.example('vanilla');
  assert.deepEqual(files.map(file => file.path), manifest.examples.vanilla.files);
  const project = path.join(scratch, 'project');
  await mkdir(project);
  const result = await execute('node', [bin, 'example', 'vanilla'], { cwd: project, env: { ...process.env, TRIM_REGISTRY_URL: url } });
  assert.match(result.stdout, /Dependencies have not been installed/);
  for (const relative of manifest.examples.vanilla.files) {
    assert.deepEqual(await readFile(path.join(project, 'vanilla', relative)), await readFile(path.join(exampleDir, relative)));
  }
  await assert.rejects(access(path.join(project, 'vanilla/unlisted.txt')));
  await assert.rejects(access(path.join(project, 'vanilla/node_modules')));
  await assert.rejects(runExampleCommand(project, 'vanilla', client), /Destination already exists/);
  await assert.rejects(runExampleCommand(project, 'unknown', client), /Available examples: headless, vanilla/);
  await assert.rejects(access(path.join(project, 'unknown')));
  for (const args of [[], ['vanilla', 'extra'], ['--bad']]) {
    await assert.rejects(execute('node', [bin, 'example', ...args], { cwd: project }), error => error.code === 1 && /Usage: trim example <name>/.test(error.stderr));
  }
  // Symlink destinations and sources must never write/read outside the tree.
  const secondProject = path.join(scratch, 'second');
  await mkdir(secondProject);
  await symlink(project, path.join(secondProject, 'vanilla'));
  await assert.rejects(runExampleCommand(secondProject, 'vanilla', client), /Destination already exists/);
  await rm(path.join(exampleDir, 'app/page.tsx'));
  await symlink(path.join(exampleDir, 'package.json'), path.join(exampleDir, 'app/page.tsx'));
  await assert.rejects(client.example('vanilla'), /Unsupported registry entry/);
  await rm(path.join(exampleDir, 'app/page.tsx'));
  await writeFile(path.join(exampleDir, 'app/page.tsx'), 'restored');

  // A concurrent destination creation after planning is refused.
  const plan = await buildRegistryExamplePlan(secondProject, 'headless', client);
  await mkdir(plan.destination);
  await writeFile(path.join(plan.destination, 'keep'), 'untouched');
  await assert.rejects(applyRegistryExamplePlan(plan), /EEXIST/);
  assert.equal(await readFile(path.join(plan.destination, 'keep'), 'utf8'), 'untouched');
  // Write failure rolls back the new directory, making retries possible.
  const failed = { destination: path.join(scratch, 'failed'), files: [{ path: 'a', contents: bytes }, { path: 'a/b', contents: bytes }] };
  await assert.rejects(applyRegistryExamplePlan(failed));
  await assert.rejects(access(failed.destination));

  const requests = [];
  server = createServer(async (req, res) => {
    requests.push(req.url);
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
      res.end(await readFile(path.join(scratch, relative)));
    } catch { res.writeHead(404); res.end('missing'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const httpUrl = `http://127.0.0.1:${server.address().port}/registry/registry.json`;
  const remoteProject = path.join(scratch, 'remote');
  await mkdir(remoteProject);
  await execute('node', [bin, 'example', 'vanilla'], { cwd: remoteProject, env: { ...process.env, TRIM_REGISTRY_URL: httpUrl } });
  assert.deepEqual(requests, ['/registry/registry.json', ...manifest.examples.vanilla.files.map(file => '/registry/examples/vanilla/' + file.split('/').map(encodeURIComponent).join('/'))]);
  for (const relative of manifest.examples.vanilla.files) {
    assert.deepEqual(await readFile(path.join(remoteProject, 'vanilla', relative)), await readFile(path.join(exampleDir, relative)));
  }
  await rm(path.join(exampleDir, 'app/page.tsx'));
  const missingProject = path.join(scratch, 'missing');
  await mkdir(missingProject);
  await assert.rejects(runExampleCommand(missingProject, 'vanilla', new RegistryClient(httpUrl)), /HTTP 404/);
  await assert.rejects(access(path.join(missingProject, 'vanilla')));
  await assert.rejects(runExampleCommand(missingProject, 'vanilla', client), /ENOENT/);
  await assert.rejects(access(path.join(missingProject, 'vanilla')));
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
console.log('PASS registry examples: manifest validation, resolution, file/HTTP transports, binary copying, CLI wiring, conflicts, failure rollback, and no package install');
