// Trim CLI — `trim detect`'s batch generation. Deliberately builds NO
// second control-file generator: every detected candidate becomes a plain
// NewControlSpec (binding mode "existing" — an already-concrete, host-owned
// TrimBinding import, exactly the same shape `trim new control`'s own
// "Existing TrimBinding" flow produces) and flows through the SAME
// buildNewControlPlan/applyNewControlPlan cli/generators/new-control-plan.ts
// already exports. No refactor of that module was needed — it was already
// shaped to be called with a spec built any way a caller likes.
//
// Transactional across the WHOLE batch, not just each individual control:
// every id/uniqueness/import/export check for every selected candidate
// runs BEFORE any file is written (see buildDetectBatchPlan). Given that
// passes, applying each spec's own already-transactional
// buildNewControlPlan/applyNewControlPlan pair in sequence cannot fail
// partway for the reasons already ruled out up front — the same reasoning
// cli/generators/example-plan.ts's own header documents for its own batch.
//
// Detected controls are always host-managed (binding mode "existing") —
// this never touches trim/trim.settings.ts, exactly like `trim new
// control`'s own "existing" mode never does.

import type { ModuleResolutionMode } from "../project/detect-project";
import { isValidControlId } from "../project/control-id";
import { resolveImportTarget, symbolAppearsExported } from "../project/binding-validation";
import { buildNewControlPlan, applyNewControlPlan, controlAlreadyExists, controlFilePath, type NewControlPlan } from "./new-control-plan";
import type { NewControlSpec, SegmentedOptionSpec, ControlKind } from "./control-file";
import { UsageError } from "../dispatch";

export type DetectGenerationInput = {
  id: string;
  label: string;
  kind: ControlKind;
  /** Required (and only meaningful) for kind === "segmented" — literal-as-both-value-and-label, per this step's own spec (no per-option label editing in v1). */
  options?: readonly SegmentedOptionSpec[];
  /** Project-root-relative, extensionless, e.g. "src/accessibility". */
  importPath: string;
  symbol: string;
};

export type DetectBatchPlan = {
  specs: readonly NewControlSpec[];
};

/**
 * Reads only — never writes. Validates the ENTIRE batch before returning:
 * every id is valid kebab-case, unique within the batch, and doesn't
 * already exist as a declared control; every binding's source file still
 * resolves and its symbol still appears exported. A fresh, disk-based
 * re-check (not the possibly-stale ts.Program the scan itself used) is
 * exactly right here: it's the only way to catch a binding that changed or
 * disappeared during the interactive selection/confirmation that followed
 * the scan (this step's own spec, section 31).
 */
export async function buildDetectBatchPlan(cwd: string, inputs: readonly DetectGenerationInput[]): Promise<DetectBatchPlan> {
  if (inputs.length === 0) {
    throw new UsageError("no candidates were selected — nothing to generate.");
  }

  const seenIds = new Set<string>();
  for (const input of inputs) {
    if (!isValidControlId(input.id)) {
      throw new UsageError(`"${input.id}" is not a valid control id — use kebab-case (lowercase letters, digits, hyphens; must start with a letter).`);
    }
    if (seenIds.has(input.id)) {
      throw new UsageError(`"${input.id}" was chosen for more than one detected candidate in this batch — each id must be unique.`);
    }
    seenIds.add(input.id);

    if (controlAlreadyExists(cwd, input.id)) {
      throw new UsageError(`control "${input.id}" already exists at ${controlFilePath(input.id)} — trim detect never overwrites an existing declaration.`);
    }

    const resolved = resolveImportTarget(cwd, input.importPath);
    if (!resolved) {
      throw new UsageError(
        `the binding detected for "${input.id}" (${input.importPath}#${input.symbol}) could not be found — it may have moved or been removed since the scan. Re-run \`trim detect\`.`,
      );
    }
    if (!symbolAppearsExported(resolved, input.symbol)) {
      throw new UsageError(`"${input.symbol}" no longer appears to be exported from ${input.importPath} — it may have changed since the scan. Re-run \`trim detect\`.`);
    }
  }

  const specs: NewControlSpec[] = inputs.map((input) => ({
    id: input.id,
    kind: input.kind,
    label: input.label,
    allowMultiple: false, // detection cannot infer composition uniqueness from host state — see this step's own spec, section 22
    options: input.kind === "segmented" ? input.options : undefined,
    binding: { mode: "existing", importPath: input.importPath, symbol: input.symbol },
  }));

  return { specs };
}

/** Only ever called with a plan buildDetectBatchPlan produced — see cli/commands/detect.ts. */
export async function applyDetectBatchPlan(cwd: string, plan: DetectBatchPlan, moduleResolution: ModuleResolutionMode): Promise<readonly NewControlPlan[]> {
  const results: NewControlPlan[] = [];
  for (const spec of plan.specs) {
    const controlPlan = await buildNewControlPlan(cwd, spec, moduleResolution);
    await applyNewControlPlan(cwd, controlPlan);
    results.push(controlPlan);
  }
  return results;
}
