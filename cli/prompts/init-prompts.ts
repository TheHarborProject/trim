// Trim CLI — the real, interactive `trim init` prompts. A thin adapter that
// turns a reconciled adapter/shell/styling flow into an `InitAnswers`
// through the shared `Prompter` seam (cli/prompts/prompter.ts) instead of
// talking to readline or @inquirer/prompts directly — production usage
// gets the real, @inquirer/prompts-backed Prompter
// (cli/prompts/inquirer-prompter.ts), and cli/commands/init.ts's
// `runInitCommand` takes a `Prompter` the same way every other wizard
// does, so tests can inject a scripted fake with no TTY at all.
//
// Reconciled flow (no redundant prompts — see this step's own spec):
//
//   1. "UI integration:" — a single select whose value maps directly to
//      `ui.adapter`. "Use project shadcn" is offered ONLY when
//      project.shadcnConfigured (mirroring the old useShadcn confirm's own
//      gating exactly) — never shown otherwise, so a "yes" can never come
//      from a question that had no real prerequisite behind it.
//   2. "Panel shell:" — asked only when the chosen adapter HAS a visible
//      shell concept at all ("vanilla" or "shadcn", never "headless").
//   3. "How should Trim be styled?" (narrowed to default/tokens — the old
//      third choice, "headless", is now simply `adapter: "headless"`) —
//      asked only when `adapter === "vanilla"`: shadcn inherits the host's
//      own design system automatically, and headless has no Trim-authored
//      visual output at all, so styling is meaningless for either.
//   4. "Add Trim theme import to <path>?" — asked only when BOTH (a)
//      `adapter === "vanilla"` (the only adapter that ever needs a Trim CSS
//      import at all — see step 3's own reasoning) and (b)
//      `project.globalStylesheet !== undefined` (a safe, existing global
//      stylesheet was actually found — see detect-project.ts's
//      findGlobalStylesheet). A "Yes" here is the only thing that makes
//      buildInitPlan (cli/generators/init-files.ts) actually edit that
//      file; "No" (or never asking at all) leaves it exactly as before this
//      question existed — the printed manual instruction.

import type { ProjectInfo } from "../project/detect-project";
import type { InitAnswers, VanillaStyling } from "../generators/init-files";
import type { TrimUIAdapterValue, TrimShellValue } from "../project/trim-metadata";
import type { Choice, Prompter } from "./prompter";

const SHADCN_CHOICE: Choice<TrimUIAdapterValue> = { name: "Use project shadcn", value: "shadcn" };
const BASE_ADAPTER_CHOICES: readonly Choice<TrimUIAdapterValue>[] = [
  { name: "Use Trim vanilla UI", value: "vanilla" },
  { name: "Headless", value: "headless" },
];

const SHELL_CHOICES: readonly Choice<TrimShellValue>[] = [
  { name: "Popover (recommended)", value: "popover" },
  { name: "Dialog", value: "dialog" },
  { name: "Inline", value: "inline" },
];

const VANILLA_STYLING_CHOICES: readonly Choice<VanillaStyling>[] = [
  { name: "Use Trim default theme (default)", value: "default" },
  { name: "Use project design tokens", value: "tokens" },
];

const IMPORT_STYLESHEET_CHOICES: readonly Choice<boolean>[] = [
  { name: "Yes", value: true },
  { name: "No", value: false },
];

export async function collectInitAnswers(project: ProjectInfo, prompter: Prompter): Promise<InitAnswers> {
  // "require the prerequisite before accepting shadcn": the choice is never
  // even offered when shadcn isn't configured, so `adapter: "shadcn"` can
  // never come from someone mistakenly picking a choice that wasn't really
  // available — see init-files.ts's own defense-in-depth check for the
  // case a caller bypasses this prompt entirely (a test, a future
  // non-interactive mode).
  const adapterChoices: Choice<TrimUIAdapterValue>[] = project.shadcnConfigured ? [SHADCN_CHOICE, ...BASE_ADAPTER_CHOICES] : [...BASE_ADAPTER_CHOICES];
  if (!project.shadcnConfigured) {
    console.log("shadcn does not appear to be configured in this project (no components.json found) — \"Use project shadcn\" isn't offered.\n" + "Set it up first (https://ui.shadcn.com/docs/installation) and re-run `trim init` to enable it.");
  }
  const adapter = await prompter.select<TrimUIAdapterValue>({ message: "UI integration:", choices: adapterChoices, default: "vanilla" });

  // No shell concept applies to "headless" at all — see src/react/config.ts's
  // TrimShell/resolveShell: there is nothing for this question to configure.
  let shell: TrimShellValue | undefined;
  if (adapter !== "headless") {
    shell = await prompter.select<TrimShellValue>({ message: "Panel shell:", choices: [...SHELL_CHOICES], default: "popover" });
  }

  // Only "vanilla" has a real styling choice: shadcn inherits the host's
  // own design system automatically ("Trim owns behavior, host owns
  // presentation"), and headless has no Trim-authored visual output at all.
  let styling: VanillaStyling | undefined;
  if (adapter === "vanilla") {
    styling = await prompter.select<VanillaStyling>({ message: "How should Trim be styled?", choices: [...VANILLA_STYLING_CHOICES], default: "default" });
  }

  // Only offered when there's actually something safe to edit: a real,
  // detected global stylesheet, and an adapter that genuinely needs a Trim
  // CSS import (shadcn/headless never do — see this file's own header).
  let importStylesheet: boolean | undefined;
  if (adapter === "vanilla" && project.globalStylesheet !== undefined) {
    importStylesheet = await prompter.select<boolean>({
      message: `Add Trim theme import to ${project.globalStylesheet}?`,
      choices: [...IMPORT_STYLESHEET_CHOICES],
      default: true,
    });
  }

  return { adapter, shell, styling, importStylesheet };
}
