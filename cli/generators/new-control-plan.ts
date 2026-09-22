// Trim CLI — `trim new control`'s plan building and application.
// Transactional by construction, not by a diff-and-abort step like init's:
// `buildNewControlPlan` either returns a complete, ready-to-write plan or
// throws (a UsageError, for anything the user needs to fix) — it never
// writes anything itself, so any validation failure leaves the filesystem
// completely untouched. `applyNewControlPlan` only ever receives a plan
// that already passed every check.
//
// trim/trim.manifest.ts and trim/trim.settings.ts are always regenerated
// wholesale here, never diffed against disk: both are 100% CLI-owned (see
// their own generators' headers — "do not hand-edit"), so there is no
// "conflict" concept for them the way init.ts has for trim.config.tsx.
// The one file that genuinely must not already exist is the new
// trim/controls/<id>.trim.ts declaration itself.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ModuleResolutionMode } from "../project/detect-project";
import { generateControlFileContents, type NewControlSpec } from "./control-file";
import { generateManifestFileContents } from "./manifest-file";
import { generateSettingsFileContents, parseExistingManagedSettings, type TrimManagedSetting } from "./settings-file";
import { UsageError } from "../dispatch";

export const CONTROLS_DIR = "trim/controls";
export const MANIFEST_PATH = "trim/trim.manifest.ts";
export const SETTINGS_PATH = "trim/trim.settings.ts";

export function controlFilePath(id: string): string {
  return `${CONTROLS_DIR}/${id}.trim.ts`;
}

/**
 * Exported so callers (cli/commands/new-control.ts) can fail BEFORE
 * running the interactive wizard, not just when buildNewControlPlan
 * finally gets to it — no point asking someone ten questions only to
 * reject the answer on the id they typed before any of them.
 * buildNewControlPlan below still re-checks this itself as a second, safe
 * guard for any caller that skips the early check.
 */
export function controlAlreadyExists(cwd: string, id: string): boolean {
  return existsSync(path.join(cwd, controlFilePath(id)));
}

/** Exported for ./example-plan.ts's "is this project's Trim setup genuinely empty?" precondition check. */
export async function listExistingControlIds(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(cwd, CONTROLS_DIR));
    return entries.filter((f) => f.endsWith(".trim.ts")).map((f) => f.slice(0, -".trim.ts".length));
  } catch {
    return [];
  }
}

/** Exported for ./example-plan.ts's canonical-starter replacement path, which needs the same spec -> TrimManagedSetting mapping `trim new control` uses, computed for a fixed list of specs rather than one at a time. */
export function toManagedSetting(spec: NewControlSpec): TrimManagedSetting {
  if (spec.binding.mode !== "trim-managed") {
    throw new Error("toManagedSetting called on a non-Trim-managed spec — this is a CLI bug, not a user-facing condition.");
  }
  if (spec.kind === "segmented") {
    return { key: spec.id, kind: "segmented", options: (spec.options ?? []).map((o) => o.value), defaultValue: spec.binding.defaultValue as string };
  }
  return { key: spec.id, kind: "boolean", defaultValue: spec.binding.defaultValue as boolean };
}

export type NewControlPlan = {
  controlFile: { path: string; contents: string };
  manifestFile: { path: string; contents: string };
  /** Present only when the control is Trim-managed. */
  settingsFile?: { path: string; contents: string };
};

/** Reads only — never writes. Throws UsageError for any condition that means nothing should be written. */
export async function buildNewControlPlan(cwd: string, spec: NewControlSpec, moduleResolution: ModuleResolutionMode): Promise<NewControlPlan> {
  if (controlAlreadyExists(cwd, spec.id)) {
    throw new UsageError(`control "${spec.id}" already exists at ${controlFilePath(spec.id)} — trim new control never overwrites an existing declaration. Choose a different id, or edit that file by hand.`);
  }

  const controlFile = { path: controlFilePath(spec.id), contents: generateControlFileContents(spec, moduleResolution) };

  const existingControlIds = await listExistingControlIds(cwd);
  const manifestFile = { path: MANIFEST_PATH, contents: generateManifestFileContents([...existingControlIds, spec.id], moduleResolution) };

  let settingsFile: { path: string; contents: string } | undefined;
  if (spec.binding.mode === "trim-managed") {
    const existingSource = await readIfExists(cwd, SETTINGS_PATH);
    const existingSettings = existingSource ? parseExistingManagedSettings(existingSource) : [];
    if (existingSettings.some((s) => s.key === spec.id)) {
      // Should already be caught by the control-file existence check above
      // (a Trim-managed setting only ever exists for a control that also
      // has a declaration file) — kept as a second, independent guard
      // rather than trusted to never happen.
      throw new UsageError(`trim.settings.ts already has a Trim-managed setting for "${spec.id}" — resolve the inconsistency by hand before retrying.`);
    }
    settingsFile = { path: SETTINGS_PATH, contents: generateSettingsFileContents([...existingSettings, toManagedSetting(spec)]) };
  }

  return { controlFile, manifestFile, settingsFile };
}

async function readIfExists(cwd: string, relativePath: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(cwd, relativePath), "utf8");
  } catch {
    return undefined;
  }
}

/** Writes every file in the plan. Only ever called with a plan buildNewControlPlan successfully produced — see this module's header. */
export async function applyNewControlPlan(cwd: string, plan: NewControlPlan): Promise<void> {
  const writes = [plan.controlFile, plan.manifestFile, ...(plan.settingsFile ? [plan.settingsFile] : [])];
  for (const file of writes) {
    const fullPath = path.join(cwd, file.path);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.contents, "utf8");
  }
}
