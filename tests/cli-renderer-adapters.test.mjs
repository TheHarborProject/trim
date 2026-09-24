import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import promises from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const { runInitCommand } = require(path.join(root, "dist/cli/commands/init.js"));
const { runAddCommand } = require(path.join(root, "dist/cli/commands/add.js"));
const { buildGeneratedPluginPlan, applyGeneratedPluginPlan, GENERATED_PLUGINS } = require(path.join(root, "dist/cli/generators/generated-plugin-plan.js"));
const { buildInitPlan, applyInitPlan } = require(path.join(root, "dist/cli/generators/init-files.js"));
const { detectProject } = require(path.join(root, "dist/cli/project/detect-project.js"));
const { UsageError } = require(path.join(root, "dist/cli/dispatch.js"));

const rootDir = mkdtempSync(path.join(root, ".trim-renderer-adapter-test-"));
const configPath = (dir) => path.join(dir, "trim/trim.config.tsx");
const shadcn = async (name) => {
  const dir = path.join(rootDir, name);
  mkdirSync(path.join(dir, "components/ui"), { recursive: true });
  writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { moduleResolution: "bundler", baseUrl: ".", paths: { "@/*": ["./*"] } } }));
  writeFileSync(path.join(dir, "components.json"), JSON.stringify({ aliases: { ui: "@/components/ui" } }));
  for (const file of ["switch.js", "toggle-group.js", "toggle.js"]) writeFileSync(path.join(dir, "components/ui", file), "export const placeholder = true;\n");
  return dir;
};
const vanilla = async (name) => {
  const dir = path.join(rootDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { moduleResolution: "bundler" } }));
  return dir;
};
const prompter = { select: async ({ choices }) => choices.find((choice) => choice.value === "inline")?.value ?? choices[0].value, confirm: async () => false, input: async () => "" };

try {
  const dir = await shadcn("shadcn");
  await runInitCommand(dir, prompter, "shadcn");
  const mapPath = path.join(dir, "trim/trim.renderers.tsx");
  const map = readFileSync(mapPath, "utf8");
  assert.match(map, /"toggle": ShadcnBooleanControl/);
  assert.match(map, /"segmented": ShadcnSegmentedControl/);
  assert.match(map, /"toggle-action": ShadcnToggleActionControl/);
  const rendererFiles = ["trim/renderers/shadcn-boolean.tsx", "trim/renderers/shadcn-segmented.tsx", "trim/renderers/shadcn-toggle-action.tsx"];
  const before = [mapPath, ...rendererFiles.map((file) => path.join(dir, file))].map((file) => ({ file, bytes: readFileSync(file), mtime: statSync(file).mtimeMs }));
  await runAddCommand(dir, "@default/plugins/text-size");
  const config = readFileSync(configPath(dir), "utf8");
  assert.match(config, /controls: \[\s*"text-size",?\s*\]/);
  for (const entry of before) {
    assert.deepEqual(readFileSync(entry.file), entry.bytes, `${entry.file} remains byte-identical`);
    assert.equal(statSync(entry.file).mtimeMs, entry.mtime, `${entry.file} is not rewritten`);
  }
  const stale = await buildInitPlan(detectProject(dir), { adapter: "shadcn", shell: "inline" });
  writeFileSync(mapPath, `${map}\n// changed externally\n`);
  await assert.rejects(applyInitPlan(dir, stale), /changed during init planning/);
  assert.match(readFileSync(mapPath, "utf8"), /changed externally/);

  const headless = await vanilla("headless");
  await runInitCommand(headless, prompter, "headless");
  const headlessConfigBefore = readFileSync(configPath(headless));
  await assert.rejects(runAddCommand(headless, "@default/plugins/text-size", { renderer: "unknown.segmented" }), /unknown renderer/);
  assert.deepEqual(readFileSync(configPath(headless)), headlessConfigBefore, "unknown renderer fails before writes");
  await assert.rejects(runAddCommand(headless, "@default/plugins/text-size"), /headless.*no renderer/);
  await runAddCommand(headless, "@default/plugins/text-size", { renderer: "vanilla.segmented" });
  assert.match(readFileSync(configPath(headless), "utf8"), /DefaultSegmentedControlOverride/);
  assert.match(readFileSync(configPath(headless), "utf8"), /adapter: "headless"/);
  await assert.rejects(runAddCommand(headless, "@default/plugins/text-size", { renderer: "vanilla.toggle" }), /cannot render control kind/);
  assert.equal(existsSync(path.join(headless, "@shadcn")), false);

  const conflict = await shadcn("conflict");
  await runInitCommand(conflict, prompter, "shadcn");
  const conflictBefore = readFileSync(configPath(conflict));
  await assert.rejects(runAddCommand(conflict, "@default/plugins/text-size", { adapter: "vanilla" }), /conflicts with --adapter/);
  assert.deepEqual(readFileSync(configPath(conflict)), conflictBefore, "conflicting adapter fails before writes");

  const rollback = await vanilla("rollback");
  await runInitCommand(rollback, prompter, "vanilla");
  const rollbackPlan = await buildGeneratedPluginPlan(rollback, GENERATED_PLUGINS[0]);
  const originalWrite = promises.writeFile;
  const originalUnlink = promises.unlink;
  let injected = false;
  promises.writeFile = async (file, ...args) => {
    if (!injected && file.endsWith("trim.manifest.ts")) { injected = true; await originalWrite(file, "partial\n"); throw new Error("injected write failure"); }
    return originalWrite(file, ...args);
  };
  promises.unlink = async (file) => { if (file.endsWith("text-size.trim.ts")) throw new Error("injected rollback failure"); return originalUnlink(file); };
  try { await assert.rejects(applyGeneratedPluginPlan(rollback, rollbackPlan), /rollback could not restore/); }
  finally { promises.writeFile = originalWrite; promises.unlink = originalUnlink; }

  const misleading = await vanilla("misleading");
  await runInitCommand(misleading, prompter, "vanilla");
  writeFileSync(configPath(misleading), `import { defineTrimConfig } from "@theharborproject/trim/react";
const nested = { adapter: "unrelated" };
export default defineTrimConfig({
  // adapter: "comment-only"
  metadata: nested,
  groups: [{ id: "starter", label: "Example", controls: ["starter"] }],
});
`);
  await runAddCommand(misleading, "@default/plugins/text-size", { adapter: "vanilla" });
  assert.match(readFileSync(configPath(misleading), "utf8"), /ui:\s*\{[\s\S]*adapter: "vanilla"/);
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
console.log("PASS renderer-adapter CLI contract: shadcn map, simple refs, no rewrites, stale init, headless and explicit renderer behavior");
