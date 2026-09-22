// `trim attach <control-id>` — composition only. Places an already-declared
// control into trim/trim.config.tsx's `groups`, and nothing else.
//
// Mental model: new = declare, attach = compose. This command NEVER:
// - modifies the control declaration (trim/controls/<id>.trim.ts)
// - modifies trim/trim.settings.ts
// - modifies trim/trim.manifest.ts
// - generates a renderer override — a new attachment is always the bare
//   control id; {id, component} overrides are a later renderer/template
//   command's job, not this one's
// - branches on the shadcn/styling preference in trim/trim.json (read only
//   to confirm the project is initialized)
//
// `runAttachCommand` is the whole command, decoupled from process.cwd()
// and real stdin — `attachCommand` (the actual dispatch.ts CommandHandler)
// supplies the real ones. Tests call `runAttachCommand` directly with a
// fixture cwd and a scripted `Prompter` (see cli/prompts/prompter.ts and
// cli/prompts/attach-prompts.ts), no TTY needed.

import { readTrimMetadata } from "../project/trim-metadata";
import { gatherAttachInfo, buildAttachEdit, applyAttachEdit } from "../generators/attach-plan";
import { collectAttachAnswers } from "../prompts/attach-prompts";
import { inquirerPrompter } from "../prompts/inquirer-prompter";
import type { Prompter } from "../prompts/prompter";
import { UsageError, type CommandHandler } from "../dispatch";

function describePosition(position: "append" | { before: string } | { after: string }): string {
  if (position === "append") return "append";
  return "before" in position ? `before "${position.before}"` : `after "${position.after}"`;
}

export async function runAttachCommand(cwd: string, id: string, prompter: Prompter): Promise<void> {
  const metadata = await readTrimMetadata(cwd);
  if (!metadata) {
    throw new UsageError("no trim/trim.json found — this project hasn't been initialized for Trim yet. Run `trim init` first.");
  }

  const info = await gatherAttachInfo(cwd, id);
  const answers = await collectAttachAnswers(info, prompter);
  const newConfigText = buildAttachEdit(info, answers);
  await applyAttachEdit(info.configFullPath, newConfigText);

  const groupLabel = answers.mode === "new-group" ? answers.groupLabel : (info.parsed.groups.find((g) => g.id === answers.groupId)?.label ?? answers.groupId);

  console.log(`✓ Attached "${id}" to "${groupLabel}"`);
  console.log(`  position: ${describePosition(answers.mode === "new-group" ? "append" : answers.position)}`);
  console.log("");
  console.log("No settings or bindings were changed.");
  if (!info.isUnique && info.alreadyAttachedIn.length > 0) {
    console.log(`"${id}" now appears in ${info.alreadyAttachedIn.length + 1} location(s).`);
  }
}

export const attachCommand: CommandHandler = async (args) => {
  const [id] = args;
  if (!id) throw new UsageError("Usage: trim attach <control-id>");
  await runAttachCommand(process.cwd(), id, inquirerPrompter);
};
