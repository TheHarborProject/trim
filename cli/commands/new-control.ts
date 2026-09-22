// `trim new control <id>` — declares one control (trim/controls/<id>.trim.ts)
// and keeps trim/trim.manifest.ts / trim/trim.settings.ts up to date.
//
// Mental model: new = declare, attach = compose. This command NEVER
// touches trim/trim.config.tsx — a freshly declared control is not placed
// into any layout; `trim attach <id>` (a later step) does that.
//
// `runNewControlCommand` is the whole command, decoupled from process.cwd()
// and real stdin — `newControlCommand` (the actual dispatch.ts
// CommandHandler) supplies the real ones. Tests call `runNewControlCommand`
// directly with a fixture cwd and a scripted `Prompter` (see
// cli/prompts/prompter.ts and cli/prompts/new-control-prompts.ts), no TTY
// needed.
//
// Sequence: read project (trim.json must exist — never silently
// initialized) -> collect answers (the wizard) -> build a plan (pure,
// read-only, throws on any invalid/conflicting condition) -> apply it
// atomically. See cli/generators/new-control-plan.ts's own header for why
// that split makes this transactional without needing a diff-and-abort
// step the way `trim init` has.

import { detectProject } from "../project/detect-project";
import { readTrimMetadata } from "../project/trim-metadata";
import { isValidControlId, suggestControlId } from "../project/control-id";
import { collectNewControlAnswers } from "../prompts/new-control-prompts";
import { inquirerPrompter } from "../prompts/inquirer-prompter";
import type { Prompter } from "../prompts/prompter";
import { buildNewControlPlan, applyNewControlPlan, controlAlreadyExists, controlFilePath } from "../generators/new-control-plan";
import { UsageError, type CommandHandler } from "../dispatch";

export async function runNewControlCommand(cwd: string, id: string, prompter: Prompter): Promise<void> {
  if (!isValidControlId(id)) {
    const suggestion = suggestControlId(id);
    throw new UsageError(
      `"${id}" is not a valid control id — use kebab-case (lowercase letters, digits, hyphens; must start with a letter), e.g. "${suggestion || "my-control"}". ` +
        "trim new control never rewrites an id automatically; run the command again with a valid one.",
    );
  }

  const metadata = await readTrimMetadata(cwd);
  if (!metadata) {
    throw new UsageError("no trim/trim.json found — this project hasn't been initialized for Trim yet. Run `trim init` first.");
  }

  // Checked before the wizard starts, not just inside buildNewControlPlan:
  // no point asking ten questions only to reject the id typed before any
  // of them.
  if (controlAlreadyExists(cwd, id)) {
    throw new UsageError(`control "${id}" already exists at ${controlFilePath(id)} — trim new control never overwrites an existing declaration. Choose a different id, or edit that file by hand.`);
  }

  const project = detectProject(cwd);

  const specOrCancelled = await collectNewControlAnswers(cwd, id, prompter);
  if (specOrCancelled === "cancelled") {
    console.log("Cancelled — nothing was created.");
    return;
  }

  const plan = await buildNewControlPlan(cwd, specOrCancelled, project.moduleResolution);
  await applyNewControlPlan(cwd, plan);

  console.log(`✓ Created ${plan.controlFile.path}`);
  console.log(`✓ Updated ${plan.manifestFile.path}`);
  if (plan.settingsFile) console.log(`✓ Updated ${plan.settingsFile.path}`);
  console.log("");
  console.log(`Control "${id}" is declared but not attached.`);
  console.log("Next:");
  console.log(`  trim attach ${id}`);
}

export const newControlCommand: CommandHandler = async (args) => {
  const [id] = args;
  if (!id) throw new UsageError("Usage: trim new control <id>");
  await runNewControlCommand(process.cwd(), id, inquirerPrompter);
};
