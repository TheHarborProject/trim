// `trim add <ref>` — installs a bundled template into the host project.
// shadcn-like: copies code, the host owns it from that point on. No remote
// registry, no network fetch — every ref resolves to a file (or, for
// "@default/example", several files plus a live generator-driven install)
// already bundled inside this package; see cli/templates-path.ts,
// cli/generators/template-registry.ts/example-plan.ts, and (for the
// "@shadcn/..." refs) cli/generators/shadcn-registry.ts.
//
// "@default/..." and "@shadcn/..." refs are both explicit and stay
// deterministic: trim.json's persisted `shadcn` preference is never read
// here — an explicit ref's behavior depends only on THIS project's actual
// files (its own components.json/tsconfig for "@shadcn/...", nothing at
// all for "@default/..."), never on what was recorded at `trim init` time.
//
// Transactional per target file, the same idempotency convention as `trim
// init`: missing -> create, existing+byte-identical -> already installed
// (no-op), existing+different -> conflict, print the plan and write
// NOTHING. No --force in this step.
//
// `runAddCommand` is the whole command, decoupled from process.cwd() —
// `addCommand` (the actual dispatch.ts CommandHandler) supplies the real
// one. Tests call `runAddCommand` directly with a fixture cwd.

import { GENERATED_PLUGINS, buildGeneratedPluginPlan, applyGeneratedPluginPlan, type GeneratedPluginInstallOptions } from "../generators/generated-plugin-plan";
import type { TrimUIAdapterValue } from "../project/trim-metadata";
import { detectProject } from "../project/detect-project";
import { findTemplateEntry, listKnownRefs, buildTemplateFilePlan, applyTemplateFilePlan, type TemplateFilePlan } from "../generators/template-registry";
import { buildExamplePlan, applyExamplePlan } from "../generators/example-plan";
import { findShadcnTemplateEntry, listShadcnRefs, buildShadcnTemplatePlan, applyShadcnTemplatePlan } from "../generators/shadcn-registry";
import { UsageError, type CommandHandler } from "../dispatch";

const STATUS_MARKER = { create: "+", matches: "✓", conflict: "!" } as const;

async function runExampleInstall(cwd: string): Promise<void> {
  const plan = await buildExamplePlan(cwd);

  console.log("");
  for (const file of plan.literalFiles) console.log(`${STATUS_MARKER[file.status]} ${file.path}`);
  if (plan.replace) console.log(`~ ${plan.replace.starterControlPath} (canonical trim init starter — will be replaced)`);

  const conflicts = plan.literalFiles.filter((f) => f.status === "conflict");
  if (conflicts.length > 0) {
    console.log("");
    console.log(`${conflicts.length} file(s) already exist with different content: ${conflicts.map((f) => f.path).join(", ")}.\nNothing was written.`);
    throw new UsageError("trim add @default/example found conflicting files (see above) — nothing was written.");
  }

  const project = detectProject(cwd);
  const result = await applyExamplePlan(cwd, plan, project.moduleResolution);

  for (const controlPath of result.controlFilePaths) console.log(`✓ Created ${controlPath}`);
  console.log(`✓ Updated trim/trim.manifest.ts`);
  console.log(`✓ Updated trim/trim.settings.ts`);
  console.log(`✓ Updated trim/trim.config.tsx (${result.attachedLabels.join(", ")})`);
  if (result.removedStarterPath) console.log(`✓ Removed ${result.removedStarterPath} (replaced by @default/example)`);
  console.log("");
  console.log("Example installed. Wire it into your app:");
  console.log('  import { ExamplePanel } from "./example-panel";');
  console.log("");
  console.log(
    'Note: "contrast" was attached using Trim\'s default toggle rendering. The installed example also ships a custom renderer at ' +
      "trim/renderers/custom-contrast.tsx — swap it in yourself in trim/trim.config.tsx if you want the exact demonstration shown there:\n" +
      '  import { CustomContrast } from "./renderers/custom-contrast";\n' +
      '  { id: "contrast", component: CustomContrast },',
  );
}

/** Shared by both the "@default/..." and "@shadcn/..." single-file installs — identical create/matches/conflict reporting either way. */
async function installSingleFilePlan(cwd: string, ref: string, plan: TemplateFilePlan, usageHint: string, apply: (cwd: string, plan: TemplateFilePlan) => Promise<void>): Promise<void> {
  if (plan.status === "conflict") {
    throw new UsageError(`! ${plan.path} already exists with different content — nothing was written. Resolve the difference by hand, or remove it and re-run \`trim add ${ref}\`.`);
  }
  if (plan.status === "matches") {
    console.log(`✓ ${plan.path} (already installed)`);
    return;
  }

  await apply(cwd, plan);
  console.log(`+ ${plan.path}`);
  console.log("");
  console.log(usageHint);
}

async function runSimpleTemplateInstall(cwd: string, ref: string): Promise<void> {
  const entry = findTemplateEntry(ref)!;
  const plan = await buildTemplateFilePlan(cwd, entry);
  await installSingleFilePlan(cwd, ref, plan, entry.usageHint, applyTemplateFilePlan);
}

async function runShadcnTemplateInstall(cwd: string, ref: string): Promise<void> {
  const entry = findShadcnTemplateEntry(ref)!;
  const plan = await buildShadcnTemplatePlan(cwd, entry);
  await installSingleFilePlan(cwd, ref, plan, entry.usageHint, applyShadcnTemplatePlan);
}

export async function runAddCommand(cwd: string, ref: string, options: GeneratedPluginInstallOptions = {}): Promise<void> {
  const plugin = GENERATED_PLUGINS.find((entry) => entry.ref === ref);
  if (plugin) {
    const plan = await buildGeneratedPluginPlan(cwd, plugin, options);
    await applyGeneratedPluginPlan(cwd, plan);
    for (const file of plan.files) console.log(`✓ ${file.path}`);
    console.log(`${plugin.control.label} installed in ${plugin.group.label}.`);
    return;
  }

  if (options.adapter || options.renderer) {
    throw new UsageError("--adapter and --renderer are supported only for canonical generated plugins (for example @default/plugins/text-size).");
  }

  if (ref === "@default/example") {
    await runExampleInstall(cwd);
    return;
  }

  if (findTemplateEntry(ref)) {
    await runSimpleTemplateInstall(cwd, ref);
    return;
  }

  if (findShadcnTemplateEntry(ref)) {
    await runShadcnTemplateInstall(cwd, ref);
    return;
  }

  throw new UsageError(`unknown template "${ref}". Available: ${[...listKnownRefs(), ...listShadcnRefs(), ...GENERATED_PLUGINS.map((entry) => entry.ref)].join(", ")}.`);
}

export const addCommand: CommandHandler = async (args) => {
  const [ref, ...flags] = args;
  if (!ref) throw new UsageError("Usage: trim add <ref>");
  const options: GeneratedPluginInstallOptions = {};
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i];
    const value = flags[i + 1];
    if ((flag !== "--adapter" && flag !== "--renderer") || value === undefined) throw new UsageError("Usage: trim add <ref> [--adapter vanilla|shadcn|headless] [--renderer name]");
    if (flag === "--adapter") {
      if (!["vanilla", "shadcn", "headless"].includes(value)) throw new UsageError("Usage: trim add <ref> [--adapter vanilla|shadcn|headless] [--renderer name]");
      if (options.adapter) throw new UsageError("trim add accepts --adapter only once.");
      options.adapter = value as TrimUIAdapterValue;
    } else {
      if (options.renderer) throw new UsageError("trim add accepts --renderer only once.");
      options.renderer = value;
    }
  }
  await runAddCommand(process.cwd(), ref, options);
};
