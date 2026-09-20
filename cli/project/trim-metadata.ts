// Trim CLI — trim/trim.json: small CLI-owned project-generation metadata.
// `trim init` writes it, future commands (starting with `trim new control`
// in this step) read it. Deliberately NOT runtime configuration: nothing
// under src/** ever imports or reads this file, and it never holds control
// definitions, groups, bindings, or anything framework-shaped — only the
// two facts a later command needs that aren't otherwise recoverable from
// the filesystem: whether the HOST wants shadcn-flavored generation, and
// which styling mode they chose. ("shadcn is installed" and "the user
// wants Trim-generated controls to use shadcn" are different facts —
// detect-project.ts's `shadcnConfigured` answers the first, this file
// answers the second.)

import { readFile } from "node:fs/promises";
import path from "node:path";

export type Styling = "default" | "tokens" | "headless";

export type TrimProjectMetadata = {
  version: 1;
  shadcn: boolean;
  styling: Styling;
};

export const TRIM_JSON_PATH = "trim/trim.json";

export function serializeTrimMetadata(metadata: TrimProjectMetadata): string {
  return JSON.stringify(metadata, null, 2) + "\n";
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
      (parsed.styling === "default" || parsed.styling === "tokens" || parsed.styling === "headless")
    ) {
      return { version: 1, shadcn: parsed.shadcn, styling: parsed.styling };
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
