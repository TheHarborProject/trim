// `trim detect` — observes existing host code, identifies bindings Trim can
// safely integrate, proposes them, and generates declarations only after
// explicit confirmation. CRITICAL RULE (this step's own spec): if Trim
// isn't sure, it must not invent a binding — a false negative is
// acceptable, a fabricated integration is not. See
// cli/project/detect-bindings.ts for the actual classification logic; this
// file is orchestration only: scan -> classify -> display -> select/confirm
// -> build batch plan -> validate -> apply (this step's own spec, section
// 27 — every stage before "apply" is read-only, and scan/classification
// runs with no TTY needed at all).
//
// One-shot, read-only until generation: no watcher, no daemon, no language
// server (this step's own spec, section 2). Never touches
// trim/trim.config.tsx (detect declares, it doesn't compose — mental model
// shared with `trim new control`) and never touches trim/trim.settings.ts
// (a detected binding is host-managed by construction — see
// cli/generators/detect-plan.ts's own header).
//
// `runDetectCommand` is the whole command, decoupled from process.cwd() and
// real stdin — `detectCommand` (the actual dispatch.ts CommandHandler)
// supplies the real ones. Tests call `runDetectCommand` directly with a
// fixture cwd and a scripted `Prompter` (see cli/prompts/prompter.ts and
// cli/prompts/detect-prompts.ts) — scan and classification themselves need
// no Prompter at all, so a test can also call them without ever reaching
// the interactive stage.

import { readTrimMetadata } from "../project/trim-metadata";
import { buildHostProgram } from "../project/ts-program";
import { scanForBindingCandidates, type DetectedCandidate } from "../project/detect-bindings";
import { listExistingControlIds, CONTROLS_DIR } from "../generators/new-control-plan";
import { collectExistingBindingSources, bindingSourceKey } from "../project/existing-bindings";
import { detectProject } from "../project/detect-project";
import { collectDetectSelection, collectDetectConfirmations } from "../prompts/detect-prompts";
import { buildDetectBatchPlan, applyDetectBatchPlan } from "../generators/detect-plan";
import { inquirerPrompter } from "../prompts/inquirer-prompter";
import type { Prompter } from "../prompts/prompter";
import { UsageError, type CommandHandler } from "../dispatch";
import path from "node:path";

type ReadyCandidate = Extract<DetectedCandidate, { status: "ready" }>;

function describeReady(candidate: ReadyCandidate): string[] {
  const lines = [`✓ ${candidate.proposedId}`, `  kind: ${candidate.kind}`];
  if (candidate.kind === "segmented") lines.push(`  values: ${candidate.options.join(" | ")}`);
  lines.push(`  binding: ${candidate.filePath}#${candidate.symbolName}`);
  return lines;
}

function describeObserved(candidate: Extract<DetectedCandidate, { status: "not-exported" | "unsupported-type" }>): string[] {
  const [headline, detail] =
    candidate.status === "not-exported"
      ? ["binding-shaped value found, but not exported", "not importable from a *.trim.ts file — export it, then re-run `trim detect`."]
      : ["TrimBinding<T> found, but its value type isn't currently supported", "only boolean or a finite string-literal union can be generated automatically."];
  return [`? ${candidate.symbolName} (${candidate.filePath})`, `  ${headline}`, `  ${detail}`];
}

export async function runDetectCommand(cwd: string, prompter: Prompter): Promise<void> {
  const metadata = await readTrimMetadata(cwd);
  if (!metadata) {
    throw new UsageError("this project is not initialized.\nRun:\n  trim init");
  }

  console.log("Scanning TypeScript project...");
  const startedAt = Date.now();
  const host = buildHostProgram(cwd);
  const { filesExamined, candidates } = scanForBindingCandidates(host, cwd);
  const durationMs = Date.now() - startedAt;
  console.log(`Scanned ${filesExamined} file(s) in ${durationMs}ms — ${candidates.length} candidate(s) found.`);

  const existingControlIds = await listExistingControlIds(cwd);
  const existingIdSet = new Set(existingControlIds);
  const existingBindingSources = await collectExistingBindingSources(host.tsc, cwd, CONTROLS_DIR, existingControlIds);

  const readyRaw = candidates.filter((c): c is ReadyCandidate => c.status === "ready");
  const observed = candidates.filter((c): c is Extract<DetectedCandidate, { status: "not-exported" | "unsupported-type" }> => c.status === "not-exported" || c.status === "unsupported-type");

  const alreadyInTrim: ReadyCandidate[] = [];
  const ready: ReadyCandidate[] = [];
  for (const candidate of readyRaw) {
    const absSourcePath = path.resolve(cwd, candidate.filePath);
    const alreadyById = existingIdSet.has(candidate.proposedId);
    const alreadyByBinding = existingBindingSources.has(bindingSourceKey(absSourcePath, candidate.symbolName));
    if (alreadyById || alreadyByBinding) alreadyInTrim.push(candidate);
    else ready.push(candidate);
  }

  if (alreadyInTrim.length > 0) {
    console.log("");
    console.log("Already in Trim");
    for (const candidate of alreadyInTrim) {
      console.log(`✓ ${candidate.proposedId} — already declared (${candidate.filePath}#${candidate.symbolName})`);
    }
  }

  if (ready.length > 0) {
    console.log("");
    console.log("Ready to integrate");
    for (const candidate of ready) {
      console.log("");
      for (const line of describeReady(candidate)) console.log(line);
    }
  }

  if (observed.length > 0) {
    console.log("");
    console.log("Observed, not safe to generate");
    for (const candidate of observed) {
      console.log("");
      for (const line of describeObserved(candidate)) console.log(line);
    }
  }

  console.log("");
  console.log(`${ready.length} control${ready.length === 1 ? "" : "s"} can be generated safely.`);
  if (observed.length > 0) {
    console.log(`${observed.length} candidate${observed.length === 1 ? "" : "s"} require${observed.length === 1 ? "s" : ""} manual integration — create manually with \`trim new control <id>\`.`);
  }

  if (ready.length === 0) return;

  const selection = await collectDetectSelection(prompter, ready);
  if (selection === "cancelled") {
    console.log("Cancelled — nothing was created.");
    return;
  }
  if (selection.length === 0) {
    console.log("Nothing selected — nothing was created.");
    return;
  }

  const inputs = await collectDetectConfirmations(cwd, prompter, selection);
  const plan = await buildDetectBatchPlan(cwd, inputs);
  const project = detectProject(cwd);
  const results = await applyDetectBatchPlan(cwd, plan, project.moduleResolution);

  console.log("");
  for (const controlPlan of results) console.log(`✓ Created "${controlPlan.controlFile.path.replace(/^trim\/controls\//, "").replace(/\.trim\.ts$/, "")}"`);
  console.log("");
  console.log(`Detected control${results.length === 1 ? " is" : "s are"} declared but not attached.`);
  console.log("Next:");
  for (const controlPlan of results) {
    const id = controlPlan.controlFile.path.replace(/^trim\/controls\//, "").replace(/\.trim\.ts$/, "");
    console.log(`  trim attach ${id}`);
  }
}

export const detectCommand: CommandHandler = async () => {
  await runDetectCommand(process.cwd(), inquirerPrompter);
};
