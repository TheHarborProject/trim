// Trim CLI — the real, interactive `trim detect` prompts. Same technique
// as the other wizards (see init-prompts.ts's header for the readline
// async-iterator rationale) — `createReadlineAsk` itself is imported from
// new-control-prompts.ts (already generic, already shared with
// cli/commands/attach.ts) rather than duplicated a third time.

import { isValidControlId, suggestControlLabel } from "../project/control-id";
import { controlAlreadyExists } from "../generators/new-control-plan";
import type { DetectedCandidate } from "../project/detect-bindings";
import type { DetectGenerationInput } from "../generators/detect-plan";
import { askRequiredChoice, askYesNo, type Ask } from "./prompt-utils";

type ReadyCandidate = Extract<DetectedCandidate, { status: "ready" }>;

/**
 * `All` / `Select individually` / `Cancel` — no default: which candidates
 * get generated is a real decision, never inferred from a blank answer.
 * Returns `"cancelled"` for the caller to turn into "nothing was created",
 * never a thrown error — the same convention new-control-prompts.ts's own
 * project-binding Cancel option uses.
 */
export async function collectDetectSelection(ask: Ask, ready: readonly ReadyCandidate[]): Promise<readonly ReadyCandidate[] | "cancelled"> {
  const choice = await askRequiredChoice(ask, "Generate detected controls?\n  1) All\n  2) Select individually\n  3) Cancel\n> ", 3);
  if (choice === 2) return "cancelled";
  if (choice === 0) return ready;

  const selected: ReadyCandidate[] = [];
  for (const candidate of ready) {
    if (await askYesNo(ask, `Include "${candidate.proposedId}" (${candidate.filePath}#${candidate.symbolName})?`, true)) {
      selected.push(candidate);
    }
  }
  return selected;
}

async function askCandidateId(cwd: string, ask: Ask, defaultId: string, alreadyChosenInBatch: ReadonlySet<string>): Promise<string> {
  while (true) {
    const answer = (await ask(`Control id: [${defaultId}] `)).trim();
    const id = answer === "" ? defaultId : answer;
    if (!isValidControlId(id)) {
      console.log(`"${id}" is not a valid control id — use kebab-case (lowercase letters, digits, hyphens; must start with a letter).`);
      continue;
    }
    if (alreadyChosenInBatch.has(id)) {
      console.log(`"${id}" was already chosen for another candidate in this batch — choose a different id.`);
      continue;
    }
    if (controlAlreadyExists(cwd, id)) {
      console.log(`"${id}" already exists as a declared control — choose a different id.`);
      continue;
    }
    return id;
  }
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
export async function collectDetectConfirmations(cwd: string, ask: Ask, selected: readonly ReadyCandidate[]): Promise<DetectGenerationInput[]> {
  const chosenIds = new Set<string>();
  const inputs: DetectGenerationInput[] = [];

  for (const candidate of selected) {
    console.log("");
    console.log(`"${candidate.symbolName}" (${candidate.filePath}) — kind: ${candidate.kind}`);
    if (candidate.kind === "segmented") {
      console.log(`  values: ${candidate.options.join(" | ")}`);
    }

    const id = await askCandidateId(cwd, ask, candidate.proposedId, chosenIds);
    chosenIds.add(id);
    const defaultLabel = suggestControlLabel(id);
    const labelAnswer = (await ask(`Label: [${defaultLabel}] `)).trim();
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
