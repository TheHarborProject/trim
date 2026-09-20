// Trim CLI — the real, interactive `trim new control` prompts. Same
// technique as cli/prompts/init-prompts.ts (readline's async-iterator
// form, not sequential question() calls — see that file's header for the
// verified reason), but exposed at a lower level here: this wizard branches
// on its own answers (control type, state, binding mode), so tests inject
// a scripted `Ask` function that answers one question at a time — exactly
// what a real user would type — rather than needing to replicate this
// file's branching logic themselves.

import { createInterface } from "node:readline/promises";
import { resolveImportTarget, symbolAppearsExported } from "../project/binding-validation";
import { suggestControlLabel } from "../project/control-id";
import type { ControlKind, SegmentedOptionSpec, BindingSpec, NewControlSpec } from "../generators/control-file";
import { UsageError } from "../dispatch";
import { askChoiceWithDefault, askRequiredChoice, askYesNo, type Ask } from "./prompt-utils";

export type { Ask };

/** The real, stdin-backed Ask — throws (never loops forever) once input is exhausted, so a dried-up interactive session or an under-specified test fails clearly instead of hanging or spinning. */
export function createReadlineAsk(): { ask: Ask; close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  const ask: Ask = async (promptText) => {
    process.stdout.write(promptText);
    const { value, done } = await lines.next();
    if (done) throw new UsageError("trim new control: ran out of input before finishing all prompts.");
    return value;
  };
  return { ask, close: () => rl.close() };
}

const CONTROL_KINDS: readonly ControlKind[] = ["boolean", "segmented", "action", "toggle-action"];

// No default: picking a control type on the user's behalf would be a real,
// consequential decision, not a harmless convenience — every answer,
// including blank, must be an explicit 1-4 choice.
async function promptControlType(ask: Ask): Promise<ControlKind> {
  const index = await askRequiredChoice(ask, "Control type:\n" + "  1) Boolean\n" + "  2) Segmented\n" + "  3) Action\n" + "  4) Toggle action\n" + "> ", CONTROL_KINDS.length);
  return CONTROL_KINDS[index];
}

async function promptLabel(ask: Ask, id: string): Promise<string> {
  const suggestion = suggestControlLabel(id);
  const answer = (await ask(`Label: [${suggestion}] `)).trim();
  return answer === "" ? suggestion : answer;
}

async function promptSegmentedOptions(ask: Ask): Promise<SegmentedOptionSpec[]> {
  const options: SegmentedOptionSpec[] = [];
  while (true) {
    const value = (await ask(`Option ${options.length + 1} value (blank to finish, at least 2 required): `)).trim();
    if (value === "") {
      if (options.length >= 2) return options;
      // Does not loop indefinitely on exhausted input: `ask` itself throws
      // once the underlying input runs out (see createReadlineAsk), so an
      // under-specified script fails clearly here rather than spinning.
      continue;
    }
    const label = (await ask(`Option ${options.length + 1} label: [${value}] `)).trim() || value;
    options.push({ value, label });
  }
}

async function promptDefaultOption(ask: Ask, options: readonly SegmentedOptionSpec[]): Promise<string> {
  // Option 1 is the documented default (annotated below) so blank input has
  // a real, stated meaning — not just an accident of a permissive parser.
  const list = options.map((o, i) => `  ${i + 1}) ${o.label} (${o.value})${i === 0 ? " (default)" : ""}`).join("\n");
  const index = await askChoiceWithDefault(ask, `Default option:\n${list}\n> `, options.length, 0);
  return options[index].value;
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

/**
 * `allowGetter: false` (Action only) skips the getter question entirely — a
 * void-valued binding has no meaningful value to read back, so the
 * generated code uses `() => undefined` instead of an import.
 *
 * No default here either: blank or unrecognized input used to silently
 * mean "Cancel", which was never a deliberate default — just the old
 * permissive parser's fallback. Cancelling is a real, distinct outcome now
 * reachable only by explicitly choosing option 3.
 */
async function promptProjectBinding(ask: Ask, cwd: string, allowGetter: boolean): Promise<BindingSpec | "cancelled"> {
  const choice = await askRequiredChoice(ask, "Project binding:\n" + "  1) Existing TrimBinding\n" + "  2) callback(get, set, subscribe)\n" + "  3) Cancel and create manually\n" + "> ", 3);

  if (choice === 0) {
    const importPath = (await ask("Import path (relative to the project root, e.g. src/lib/theme-binding): ")).trim();
    const symbol = (await ask("Exported symbol: ")).trim();
    validateBindingSource(cwd, importPath, symbol);
    return { mode: "existing", importPath, symbol };
  }
  if (choice === 1) {
    const importPath = (await ask("Import path (relative to the project root): ")).trim();
    const getSymbol = allowGetter ? (await ask("Getter export: ")).trim() : undefined;
    const setSymbol = (await ask("Setter export: ")).trim();
    const subscribeAnswer = (await ask("Subscribe export (optional, press enter to skip): ")).trim();
    const subscribeSymbol = subscribeAnswer === "" ? undefined : subscribeAnswer;
    if (getSymbol) validateBindingSource(cwd, importPath, getSymbol);
    validateBindingSource(cwd, importPath, setSymbol);
    if (subscribeSymbol) validateBindingSource(cwd, importPath, subscribeSymbol);
    return { mode: "callback", importPath, getSymbol, setSymbol, subscribeSymbol };
  }
  // choice === 2: explicit cancel.
  return "cancelled";
}

/**
 * `id` is already validated (kebab-case) and confirmed not to exist yet by
 * the time this runs — see cli/commands/new-control.ts. Returns
 * "cancelled" when the user backs out of the project-binding sub-flow,
 * which the caller turns into "nothing was created", never a thrown error.
 */
export async function collectNewControlAnswers(cwd: string, id: string, ask: Ask): Promise<NewControlSpec | "cancelled"> {
  const kind = await promptControlType(ask);
  const label = await promptLabel(ask, id);
  const allowMultiple = await askYesNo(ask, "Can this control appear more than once?", false);

  // Action controls have no value to persist (TrimBinding<void>), so
  // "Trim-managed" doesn't apply — they go straight to a project binding,
  // per the agreed "a different binding flow only where the real type
  // requires one" rule.
  if (kind === "action") {
    const binding = await promptProjectBinding(ask, cwd, false);
    return binding === "cancelled" ? "cancelled" : { id, kind, label, allowMultiple, binding };
  }

  const options = kind === "segmented" ? await promptSegmentedOptions(ask) : undefined;

  // No default: Trim-managed vs. a project binding is a meaningful choice
  // about who owns the control's state, not a convenience default —
  // previously any non-"2" input (including blank) silently meant
  // Trim-managed, which was an unintentional side effect of the old
  // permissive parser, not a deliberate default.
  const stateChoice = await askRequiredChoice(ask, "State:\n  1) Trim-managed\n  2) Project binding\n> ", 2);
  if (stateChoice === 1) {
    const binding = await promptProjectBinding(ask, cwd, true);
    return binding === "cancelled" ? "cancelled" : { id, kind, label, allowMultiple, options, binding };
  }

  const defaultValue = kind === "segmented" ? await promptDefaultOption(ask, options!) : await askYesNo(ask, "Default value:", false);
  const binding: BindingSpec = { mode: "trim-managed", defaultValue };
  return { id, kind, label, allowMultiple, options, binding };
}
