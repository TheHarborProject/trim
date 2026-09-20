// `trim init` — initializes the host project for the file-based Trim 0.2
// workflow: trim/trim.config.tsx, trim/trim.manifest.ts, trim/trim.settings.ts,
// trim/trim.json, plus an optional trim/trim.css depending on the styling
// choice.
//
// `runInitCommand` is the whole command, decoupled from process.cwd() and
// real stdin — `initCommand` (the actual dispatch.ts CommandHandler) is a
// two-line wrapper supplying the real ones. Tests call `runInitCommand`
// directly with a fixture cwd and a stub `promptForAnswers`, no TTY needed
// (see cli/prompts/init-prompts.ts's header for why there's no prompt
// dependency to begin with).
//
// Transactional: the plan is built and printed in full BEFORE anything is
// written, and if any file in it is a genuine "conflict" (see
// init-files.ts's FileStatus doc), NOTHING is written — not even the
// otherwise-safe "create"/"update" entries in the same plan. Re-running
// `trim init` is meant to be easy to reason about: either everything in
// the plan that could safely happen did, or nothing did.
//
// This is NOT the canonical example installer: it creates an EMPTY Trim
// setup (empty manifest, empty config groups). `trim add @default/example`
// (not implemented in this step) is what installs the demonstration setup.

import { detectProject, type ProjectInfo } from "../project/detect-project";
import { buildInitPlan, applyInitPlan, type InitAnswers, type FileStatus } from "../generators/init-files";
import { collectInitAnswers } from "../prompts/init-prompts";
import { UsageError, type CommandHandler } from "../dispatch";

export type PromptForAnswers = (project: ProjectInfo) => Promise<InitAnswers>;

const STATUS_MARKER: Record<FileStatus, string> = { matches: "✓", conflict: "!", create: "+", update: "~" };

export async function runInitCommand(cwd: string, promptForAnswers: PromptForAnswers): Promise<void> {
  const project = detectProject(cwd);

  if (!project.isTypeScript) {
    throw new UsageError(
      "trim init currently supports TypeScript projects only (no tsconfig.json was found in this directory). " +
        "Add TypeScript to this project first, or see @theharborproject/trim's examples/default for a hand-written pattern you can adapt.",
    );
  }

  console.log(
    `Detected: ${project.packageManager}, TypeScript, moduleResolution=${project.moduleResolution}` +
      (project.shadcnConfigured ? ", shadcn configured (components.json found)." : ", shadcn not detected."),
  );

  const answers = await promptForAnswers(project);
  const plan = await buildInitPlan(project, answers);

  console.log("");
  for (const file of plan.files) console.log(`${STATUS_MARKER[file.status]} ${file.path}`);

  const conflicts = plan.files.filter((file) => file.status === "conflict");
  if (conflicts.length > 0) {
    console.log("");
    console.log(
      `${conflicts.length} file(s) already exist with different content: ${conflicts.map((f) => f.path).join(", ")}.\n` +
        "Nothing was written — trim init only applies a plan when every file in it is safe. Resolve the difference by hand, then re-run `trim init`.",
    );
    throw new UsageError("trim init found conflicting files (see above) — nothing was written.");
  }

  await applyInitPlan(cwd, plan);

  if (plan.notes.length > 0) {
    console.log("");
    for (const note of plan.notes) console.log(note);
  }

  console.log("");
  console.log(plan.integrationSnippet);

  console.log("");
  console.log(plan.files.some((file) => file.status === "create" || file.status === "update") ? "Trim initialized." : "Trim is already initialized — nothing to do.");
}

export const initCommand: CommandHandler = async () => {
  await runInitCommand(process.cwd(), collectInitAnswers);
};
