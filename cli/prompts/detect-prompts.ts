// Trim CLI — the real, interactive `trim detect` prompts, through the
// shared `Prompter` seam (cli/prompts/prompter.ts) — same pattern as every
// other wizard, so tests can inject a scripted fake `Prompter` with no TTY
// at all.

import { isValidControlId, suggestControlLabel } from "../project/control-id";
import { controlAlreadyExists } from "../generators/new-control-plan";
import type { DetectedCandidate } from "../project/detect-bindings";
import type { DetectGenerationInput } from "../generators/detect-plan";
import type { Choice, Prompter } from "./prompter";

type ReadyCandidate = Extract<DetectedCandidate, { status: "ready" }>;

/**
 * `All` / `Select individually` / `Cancel` — no default: which candidates
 * get generated is a real decision, never inferred from a blank answer.
 * Returns `"cancelled"` for the caller to turn into "nothing was created",
 * never a thrown error — the same convention new-control-prompts.ts's own
 * project-binding Cancel option uses.
 *
 * "Select individually" used to ask one confirm() per candidate ("Include
 * ... ?"); it's now a single checkbox() screen listing every candidate,
 * each pre-checked — same default-Yes behavior, one screen instead of a
 * sequence of yes/no questions.
 */
export async function collectDetectSelection(prompter: Prompter, ready: readonly ReadyCandidate[]): Promise<readonly ReadyCandidate[] | "cancelled"> {
  const choice = await prompter.select<"all" | "select" | "cancel">({
    message: "Generate detected controls?",
    choices: [
      { name: "All", value: "all" },
      { name: "Select individually", value: "select" },
      { name: "Cancel", value: "cancel" },
    ],
  });
  if (choice === "cancel") return "cancelled";
  if (choice === "all") return ready;

  const choices: Choice<ReadyCandidate>[] = ready.map((candidate) => ({
    name: `${candidate.proposedId} (${candidate.filePath}#${candidate.symbolName})`,
    value: candidate,
    checked: true,
  }));
  return prompter.checkbox<ReadyCandidate>({ message: "Include which candidates?", choices });
}

/** This one legitimately reprompted before migration (an invalid id must not silently become anything else), so `validate:` is the correct fit here — unlike the plain, non-reprompting `input()`s used for project-binding fields elsewhere in this CLI. */
async function askCandidateId(cwd: string, prompter: Prompter, defaultId: string, alreadyChosenInBatch: ReadonlySet<string>): Promise<string> {
  const id = await prompter.input({
    message: "Control id:",
    default: defaultId,
    validate: (answer) => {
      const value = answer.trim() === "" ? defaultId : answer.trim();
      if (!isValidControlId(value)) {
        return `"${value}" is not a valid control id — use kebab-case (lowercase letters, digits, hyphens; must start with a letter).`;
      }
      if (alreadyChosenInBatch.has(value)) {
        return `"${value}" was already chosen for another candidate in this batch — choose a different id.`;
      }
      if (controlAlreadyExists(cwd, value)) {
        return `"${value}" already exists as a declared control — choose a different id.`;
      }
      return true;
    },
  });
  return id.trim() === "" ? defaultId : id.trim();
}

/**
 * For each selected candidate, in order: confirm/edit the proposed id (must
 * be valid kebab-case and unique within this batch — see askCandidateId —
 * on top of the full batch re-validation buildDetectBatchPlan performs
 * before writing anything), then confirm/edit the proposed label. Segmented
 * candidates show their detected literal values for context, but per this
 * step's own spec there's no per-option label editing in v1 — the literal
 * value is used as both value and label.
 */
export async function collectDetectConfirmations(cwd: string, prompter: Prompter, selected: readonly ReadyCandidate[]): Promise<DetectGenerationInput[]> {
  const chosenIds = new Set<string>();
  const inputs: DetectGenerationInput[] = [];

  for (const candidate of selected) {
    console.log("");
    console.log(`"${candidate.symbolName}" (${candidate.filePath}) — kind: ${candidate.kind}`);
    if (candidate.kind === "segmented") {
      console.log(`  values: ${candidate.options.join(" | ")}`);
    }

    const id = await askCandidateId(cwd, prompter, candidate.proposedId, chosenIds);
    chosenIds.add(id);
    const defaultLabel = suggestControlLabel(id);
    const labelAnswer = (await prompter.input({ message: "Label:", default: defaultLabel })).trim();
    const label = labelAnswer === "" ? defaultLabel : labelAnswer;

    inputs.push({
      id,
      label,
      kind: candidate.kind,
      options: candidate.kind === "segmented" ? candidate.options.map((value) => ({ value, label: value })) : undefined,
      importPath: candidate.importPath,
      symbol: candidate.symbolName,
    });
  }

  return inputs;
}
