// `trim init` — initializes the host project for the file-based Trim 0.2
// workflow: trim/trim.config.tsx, trim/trim.manifest.ts, trim/trim.settings.ts,
// trim/trim.json, trim/controls/starter.trim.ts (a real, removable starter
// control — see init-files.ts's own header), trim/TrimPanel.tsx (the one
// component to mount, for every adapter), plus an optional trim/trim.css
// (vanilla adapter + "tokens" styling), trim/TrimShell.tsx (shadcn adapter
// + a visible shell), or an edit to the host's own detected global
// stylesheet (vanilla adapter, opted into via the "Add Trim theme import?"
// prompt) depending on the ui.adapter/ui.shell/stylesheet-import answers.
//
// `runInitCommand` is the whole command, decoupled from process.cwd() and
// real stdin — `initCommand` (the actual dispatch.ts CommandHandler) is a
// two-line wrapper supplying the real ones. Tests call `runInitCommand`
// directly with a fixture cwd and a scripted `Prompter` (cli/prompts/prompter.ts),
// no TTY needed — the same one-consistent-seam pattern every other wizard
// (new-control, attach, detect) uses, rather than init's own separate
// whole-object answer-callback this command used to take.
//
// Transactional: the plan is built and printed in full BEFORE anything is
// written, and if any file in it is a genuine "conflict" (see
// init-files.ts's FileStatus doc), NOTHING is written — not even the
// otherwise-safe "create"/"update" entries in the same plan. Re-running
// `trim init` is meant to be easy to reason about: either everything in
// the plan that could safely happen did, or nothing did.
//
// This is NOT the canonical example installer: the "starter" control it
// seeds is a single starter boolean control, not the multi-control
// demonstration setup. `trim add @default/example` is what installs that
// (into an empty Trim setup — see cli/generators/example-plan.ts's own
// header for how that precondition interacts with this seeded control).

import { detectProject } from "../project/detect-project";
import { buildInitPlan, applyInitPlan, type FileStatus } from "../generators/init-files";
import { collectInitAnswers } from "../prompts/init-prompts";
import { inquirerPrompter } from "../prompts/inquirer-prompter";
import type { Prompter } from "../prompts/prompter";
import { UsageError, type CommandHandler } from "../dispatch";

const STATUS_MARKER: Record<FileStatus, string> = { matches: "✓", conflict: "!", create: "+", update: "~" };

export async function runInitCommand(cwd: string, prompter: Prompter): Promise<void> {
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

  const answers = await collectInitAnswers(project, prompter);
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
  await runInitCommand(process.cwd(), inquirerPrompter);
};
