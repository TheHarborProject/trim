// Trim CLI — trim/trim.json: small CLI-owned project-generation metadata.
// `trim init` writes it, future commands (starting with `trim new control`
// in this step) read it. Deliberately NOT runtime configuration: nothing
// under src/** ever imports or reads this file, and it never holds control
// definitions, groups, bindings, or anything framework-shaped — only the
// facts a later command needs that aren't otherwise recoverable from the
// filesystem: whether the HOST wants shadcn-flavored generation, which
// styling mode they chose, and (as of the adapter/shell prompt
// reconciliation) which `ui.adapter`/`ui.shell` trim.config.tsx was
// generated with. ("shadcn is installed" and "the user wants Trim-generated
// controls to use shadcn" are different facts — detect-project.ts's
// `shadcnConfigured` answers the first, this file answers the second.)

import { readFile } from "node:fs/promises";
import path from "node:path";

export type Styling = "default" | "tokens" | "headless";

/** Mirrors src/react/config.ts's TrimUIAdapter, narrowed to the 3 concrete values this CLI ever generates (that file's own `(string & {})` widening exists for a host's own future adapters, not for anything this CLI itself produces). */
export type TrimUIAdapterValue = "vanilla" | "shadcn" | "headless";

/** Mirrors src/react/config.ts's TrimShell exactly — no widening needed here, since shell is only ever one of these 3 concrete values. */
export type TrimShellValue = "popover" | "dialog" | "inline";

export type TrimProjectMetadata = {
  version: 1;
  shadcn: boolean;
  styling: Styling;
  /**
   * Optional — and validated as such — so a trim.json written by a version
   * of this CLI that predates the adapter/shell prompt reconciliation still
   * parses fine (ui simply comes back undefined; nothing treats that as
   * malformed). A freshly generated trim.json always includes it.
   */
  ui?: { adapter: TrimUIAdapterValue; shell?: TrimShellValue };
};

export const TRIM_JSON_PATH = "trim/trim.json";

export function serializeTrimMetadata(metadata: TrimProjectMetadata): string {
  return JSON.stringify(metadata, null, 2) + "\n";
}

function isValidUi(value: unknown): value is TrimProjectMetadata["ui"] {
  if (value === undefined) return true; // absent entirely: fine, older trim.json format
  if (value === null || typeof value !== "object") return false;
  const adapter = (value as { adapter?: unknown }).adapter;
  const shell = (value as { shell?: unknown }).shell;
  if (adapter !== "vanilla" && adapter !== "shadcn" && adapter !== "headless") return false;
  if (shell !== undefined && shell !== "popover" && shell !== "dialog" && shell !== "inline") return false;
  return true;
}

/** Pure — no fs access — so it's directly testable against arbitrary strings. */
export function parseTrimMetadata(raw: string): TrimProjectMetadata | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === 1 &&
      typeof parsed.shadcn === "boolean" &&
      (parsed.styling === "default" || parsed.styling === "tokens" || parsed.styling === "headless") &&
      isValidUi(parsed.ui)
    ) {
      return parsed.ui !== undefined
        ? { version: 1, shadcn: parsed.shadcn, styling: parsed.styling, ui: parsed.ui }
        : { version: 1, shadcn: parsed.shadcn, styling: parsed.styling };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Undefined means "not initialized, or trim.json is missing/malformed" —
 * callers (like `trim new control`) treat that as "run `trim init` first",
 * never as a reason to guess.
 */
export async function readTrimMetadata(cwd: string): Promise<TrimProjectMetadata | undefined> {
  try {
    return parseTrimMetadata(await readFile(path.join(cwd, TRIM_JSON_PATH), "utf8"));
  } catch {
    return undefined;
  }
}
