// Trim CLI — the real, interactive `trim new control` prompts, through the
// shared `Prompter` seam (cli/prompts/prompter.ts). This wizard branches on
// its own answers (control type, state, binding mode), so tests inject a
// scripted fake `Prompter` that answers one question at a time — exactly
// what a real user would do — rather than needing to replicate this file's
// branching logic themselves.

import { resolveImportTarget, symbolAppearsExported } from "../project/binding-validation";
import { suggestControlLabel } from "../project/control-id";
import type { ControlKind, SegmentedOptionSpec, BindingSpec, NewControlSpec } from "../generators/control-file";
import { UsageError } from "../dispatch";
import type { Choice, Prompter } from "./prompter";

const CONTROL_KIND_CHOICES: readonly Choice<ControlKind>[] = [
  { name: "Boolean", value: "boolean" },
  { name: "Segmented", value: "segmented" },
  { name: "Action", value: "action" },
  { name: "Toggle action", value: "toggle-action" },
];

async function promptControlType(prompter: Prompter): Promise<ControlKind> {
  return prompter.select<ControlKind>({ message: "Control type:", choices: [...CONTROL_KIND_CHOICES] });
}

async function promptLabel(prompter: Prompter, id: string): Promise<string> {
  const suggestion = suggestControlLabel(id);
  const answer = (await prompter.input({ message: "Label:", default: suggestion })).trim();
  return answer === "" ? suggestion : answer;
}

async function promptSegmentedOptions(prompter: Prompter): Promise<SegmentedOptionSpec[]> {
  const options: SegmentedOptionSpec[] = [];
  while (true) {
    const value = (await prompter.input({ message: `Option ${options.length + 1} value (blank to finish, at least 2 required):` })).trim();
    if (value === "") {
      if (options.length >= 2) return options;
      // Bug fix within this migration's scope: the old hand-rolled loop
      // reprompted silently here, with no hint at all — inconsistent with
      // every other reprompt path in this wizard, which always says why.
      console.log(`At least 2 options are required (${options.length} so far) — enter another value, or Ctrl+C to cancel.`);
      continue;
    }
    const label = (await prompter.input({ message: `Option ${options.length + 1} label:`, default: value })).trim() || value;
    options.push({ value, label });
  }
}

async function promptDefaultOption(prompter: Prompter, options: readonly SegmentedOptionSpec[]): Promise<string> {
  const choices: Choice<string>[] = options.map((o) => ({ name: `${o.label} (${o.value})`, value: o.value }));
  return prompter.select<string>({ message: "Default option:", choices, default: options[0].value });
}

function validateBindingSource(cwd: string, importPath: string, symbol: string): void {
  if (!importPath) throw new UsageError("a project binding needs an import path.");
  if (!symbol) throw new UsageError("a project binding needs an exported symbol name.");
  const resolved = resolveImportTarget(cwd, importPath);
  if (!resolved) {
    throw new UsageError(`could not find a file at "${importPath}" (relative to the project root) — trim new control never generates an import to a path it can't find.`);
  }
  if (!symbolAppearsExported(resolved, symbol)) {
    console.log(`Note: "${symbol}" wasn't found as an export of ${importPath} by a quick textual scan — this is advisory, not a full TypeScript check (re-exports and barrels can fool it), so continuing anyway.`);
  }
}

type ProjectBindingChoice = "existing" | "callback" | "cancel";

/**
 * `allowGetter: false` (Action only) skips the getter question entirely — a
 * void-valued binding has no meaningful value to read back, so the
 * generated code uses `() => undefined` instead of an import.
 *
 * Import path/symbol fields stay plain `input()`s with no `validate:` —
 * this wizard's own long-standing collect-then-throw-UsageError-on-invalid
 * behavior for a project binding, not a reprompt loop.
 */
async function promptProjectBinding(prompter: Prompter, cwd: string, allowGetter: boolean): Promise<BindingSpec | "cancelled"> {
  const choice = await prompter.select<ProjectBindingChoice>({
    message: "Project binding:",
    choices: [
      { name: "Existing TrimBinding", value: "existing" },
      { name: "callback(get, set, subscribe)", value: "callback" },
      { name: "Cancel and create manually", value: "cancel" },
    ],
  });

  if (choice === "existing") {
    const importPath = (await prompter.input({ message: "Import path (relative to the project root, e.g. src/lib/theme-binding):" })).trim();
    const symbol = (await prompter.input({ message: "Exported symbol:" })).trim();
    validateBindingSource(cwd, importPath, symbol);
    return { mode: "existing", importPath, symbol };
  }
  if (choice === "callback") {
    const importPath = (await prompter.input({ message: "Import path (relative to the project root):" })).trim();
    const getSymbol = allowGetter ? (await prompter.input({ message: "Getter export:" })).trim() : undefined;
    const setSymbol = (await prompter.input({ message: "Setter export:" })).trim();
    const subscribeAnswer = (await prompter.input({ message: "Subscribe export (optional, press enter to skip):" })).trim();
    const subscribeSymbol = subscribeAnswer === "" ? undefined : subscribeAnswer;
    if (getSymbol) validateBindingSource(cwd, importPath, getSymbol);
    validateBindingSource(cwd, importPath, setSymbol);
    if (subscribeSymbol) validateBindingSource(cwd, importPath, subscribeSymbol);
    return { mode: "callback", importPath, getSymbol, setSymbol, subscribeSymbol };
  }
  // choice === "cancel": explicit cancel.
  return "cancelled";
}

/**
 * `id` is already validated (kebab-case) and confirmed not to exist yet by
 * the time this runs — see cli/commands/new-control.ts. Returns
 * "cancelled" when the user backs out of the project-binding sub-flow,
 * which the caller turns into "nothing was created", never a thrown error.
 */
export async function collectNewControlAnswers(cwd: string, id: string, prompter: Prompter): Promise<NewControlSpec | "cancelled"> {
  const kind = await promptControlType(prompter);
  const label = await promptLabel(prompter, id);
  const allowMultiple = await prompter.confirm({ message: "Can this control appear more than once?", default: false });

  // Action controls have no value to persist (TrimBinding<void>), so
  // "Trim-managed" doesn't apply — they go straight to a project binding,
  // per the agreed "a different binding flow only where the real type
  // requires one" rule.
  if (kind === "action") {
    const binding = await promptProjectBinding(prompter, cwd, false);
    return binding === "cancelled" ? "cancelled" : { id, kind, label, allowMultiple, binding };
  }

  const options = kind === "segmented" ? await promptSegmentedOptions(prompter) : undefined;

  const stateChoice = await prompter.select<"trim-managed" | "project-binding">({
    message: "State:",
    choices: [
      { name: "Trim-managed", value: "trim-managed" },
      { name: "Project binding", value: "project-binding" },
    ],
  });
  if (stateChoice === "project-binding") {
    const binding = await promptProjectBinding(prompter, cwd, true);
    return binding === "cancelled" ? "cancelled" : { id, kind, label, allowMultiple, options, binding };
  }

  const defaultValue = kind === "segmented" ? await promptDefaultOption(prompter, options!) : await prompter.confirm({ message: "Default value:", default: false });
  const binding: BindingSpec = { mode: "trim-managed", defaultValue };
  return { id, kind, label, allowMultiple, options, binding };
}
