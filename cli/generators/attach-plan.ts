// Trim CLI — `trim attach`'s plan building and application: composition
// only. Never touches the control declaration, trim.manifest.ts, or
// trim.settings.ts — the one file this ever writes is trim/trim.config.tsx,
// and only via cli/project/trim-config-ast.ts's minimal-splice editing, not
// a regeneration (that file is host-owned; see that module's own header).
//
// Split the same way init/new-control are: gather (reads only, throws on
// any precondition failure) -> collect answers (the wizard) -> build the
// exact edit (pure, re-validates by re-parsing) -> apply (one write).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadTypeScript, type TS } from "../project/resolve-typescript";
import { parseTrimConfig, computeAttachEdit, UnsupportedConfigShapeError, type ParsedConfig, type AttachTarget } from "../project/trim-config-ast";
import { resolveControlIsUnique } from "../project/control-uniqueness";
import { controlAlreadyExists, controlFilePath } from "./new-control-plan";
import { UsageError } from "../dispatch";

export const CONFIG_PATH = "trim/trim.config.tsx";

export type AttachAnswers =
  | { mode: "existing-group"; groupId: string; position: "append" | { before: string } | { after: string } }
  | { mode: "new-group"; groupId: string; groupLabel: string };

export type AttachInfo = {
  cwd: string;
  configFullPath: string;
  configSource: string;
  ref: string;
  isUnique: boolean;
  /** Group ids where `ref` is already attached (in either string or object form) — see trim-config-ast.ts's extractItems for why both count. */
  alreadyAttachedIn: readonly string[];
  tsc: TS;
  parsed: ParsedConfig;
};

/**
 * Reads everything needed BEFORE prompting, and fails fast on any
 * precondition — including the "unique control already attached" rule —
 * so nothing wastes the user's time on a wizard that would just be
 * rejected at the end. Never writes.
 */
export async function gatherAttachInfo(cwd: string, id: string): Promise<AttachInfo> {
  if (!controlAlreadyExists(cwd, id)) {
    throw new UsageError(`control "${id}" does not exist. Declare it first: \`trim new control ${id}\`.`);
  }

  const tsc = loadTypeScript();

  const configFullPath = path.join(cwd, CONFIG_PATH);
  let configSource: string;
  try {
    configSource = await readFile(configFullPath, "utf8");
  } catch {
    throw new UsageError(`could not read ${CONFIG_PATH} — run \`trim init\` first.`);
  }

  let parsed: ParsedConfig;
  try {
    parsed = parseTrimConfig(tsc, configSource, configFullPath);
  } catch (error) {
    if (error instanceof UnsupportedConfigShapeError) {
      throw new UsageError(`trim attach cannot safely edit this config automatically (${error.message}). Add the control manually to ${CONFIG_PATH}.`);
    }
    throw error;
  }

  const isUnique = await resolveControlIsUnique(tsc, path.join(cwd, controlFilePath(id)));
  const alreadyAttachedIn = parsed.groups.filter((g) => g.items.some((item) => item.ref === id)).map((g) => g.id);

  if (isUnique && alreadyAttachedIn.length > 0) {
    throw new UsageError(
      `control "${id}" is already attached to "${alreadyAttachedIn[0]}". Unique controls cannot be attached more than once ` +
        `(set is_unique: false on its declaration to allow that).`,
    );
  }

  return { cwd, configFullPath, configSource, ref: id, isUnique, alreadyAttachedIn, tsc, parsed };
}

/** Pure — never writes. Re-parses the resulting text as a final structural sanity check before returning it, so a caller never writes something that wouldn't itself parse as a valid config. */
export function buildAttachEdit(info: AttachInfo, answers: AttachAnswers): string {
  let target: AttachTarget;

  if (answers.mode === "new-group") {
    if (info.parsed.groups.some((g) => g.id === answers.groupId)) {
      throw new UsageError(`a group with id "${answers.groupId}" already exists.`);
    }
    target = { kind: "new-group", groupId: answers.groupId, groupLabel: answers.groupLabel };
  } else {
    const group = info.parsed.groups.find((g) => g.id === answers.groupId);
    if (!group) {
      throw new UsageError(`no group with id "${answers.groupId}" was found in ${CONFIG_PATH}.`);
    }
    target = { kind: "existing-group", group, position: answers.position };
  }

  let newText: string;
  try {
    newText = computeAttachEdit(info.parsed, info.ref, target, info.configSource);
  } catch (error) {
    if (error instanceof UnsupportedConfigShapeError) {
      throw new UsageError(error.message);
    }
    throw error;
  }

  try {
    parseTrimConfig(info.tsc, newText, info.configFullPath);
  } catch (error) {
    throw new UsageError(
      `the edited config would not parse as valid TypeScript (${error instanceof Error ? error.message : String(error)}) — nothing was written. This should not happen; please report it.`,
    );
  }

  return newText;
}

export async function applyAttachEdit(configFullPath: string, newConfigText: string): Promise<void> {
  await writeFile(configFullPath, newConfigText, "utf8");
}
