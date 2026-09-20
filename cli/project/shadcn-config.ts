// Trim CLI — reads the HOST PROJECT's shadcn configuration (components.json)
// and resolves its path aliases against that same project's own tsconfig
// `paths`/`baseUrl`. CLI-only: nothing here is imported by src/**, and
// nothing under src/** knows shadcn exists at all — see cli/generators/
// shadcn-registry.ts's own header for why that boundary matters.
//
// Deliberately conservative throughout: a missing components.json means
// "not a shadcn project" (not an error); anything that LOOKS like an
// attempt at shadcn configuration but doesn't parse, or an alias this
// module cannot resolve to a real filesystem path via the project's own
// tsconfig, is reported clearly rather than guessed at. This module never
// assumes the common "@/components/ui" convention — it reads the actual
// configured alias.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stripJsonComments } from "./detect-project";
import { UsageError } from "../dispatch";

export const COMPONENTS_JSON_PATH = "components.json";

export type ShadcnSetup = {
  /** Raw alias map from components.json's own "aliases" object, e.g. { ui: "@/components/ui", components: "@/components", ... }. Only string values are kept. */
  aliases: Readonly<Record<string, string>>;
};

/**
 * `undefined` means "no components.json at all" — a normal, silent
 * "shadcn isn't set up here", exactly like detect-project.ts's own
 * `shadcnConfigured` flag. A components.json that DOES exist but is
 * malformed or missing the one thing this module needs (`aliases`) throws
 * instead: that is a broken/incomplete shadcn setup, not "no shadcn setup",
 * and treating it as the latter could silently generate an import to a
 * guessed path.
 */
export function readShadcnSetup(cwd: string): ShadcnSetup | undefined {
  const fullPath = path.join(cwd, COMPONENTS_JSON_PATH);
  if (!existsSync(fullPath)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(fullPath, "utf8")));
  } catch {
    throw new UsageError(`${COMPONENTS_JSON_PATH} exists but is not valid JSON — fix it, or remove it if shadcn isn't actually set up in this project.`);
  }

  if (parsed === null || typeof parsed !== "object" || !("aliases" in parsed) || (parsed as { aliases: unknown }).aliases === null || typeof (parsed as { aliases: unknown }).aliases !== "object") {
    throw new UsageError(`${COMPONENTS_JSON_PATH} exists but has no "aliases" object — this doesn't look like a valid shadcn configuration. Resolve it by hand, or re-run the shadcn CLI's init.`);
  }

  const rawAliases = (parsed as { aliases: Record<string, unknown> }).aliases;
  const aliases: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawAliases)) {
    if (typeof value === "string") aliases[key] = value;
  }
  return { aliases };
}

type TsPathsConfig = { baseUrl: string; paths: Readonly<Record<string, readonly unknown[]>> };

function readTsPathsConfig(cwd: string): TsPathsConfig | undefined {
  const tsconfigPath = path.join(cwd, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(readFileSync(tsconfigPath, "utf8")));
  } catch {
    return undefined;
  }
  const compilerOptions = (parsed as { compilerOptions?: { paths?: unknown; baseUrl?: unknown } } | null)?.compilerOptions;
  const paths = compilerOptions?.paths;
  if (!paths || typeof paths !== "object") return undefined;
  const baseUrl = typeof compilerOptions?.baseUrl === "string" ? compilerOptions.baseUrl : ".";
  return { baseUrl, paths: paths as Record<string, readonly unknown[]> };
}

/**
 * Resolves an alias-based, extensionless specifier (e.g.
 * "@/components/ui/switch") to an actual PROJECT-RELATIVE filesystem path
 * (e.g. "src/components/ui/switch"), using this project's own tsconfig
 * `paths` + `baseUrl` — never assumed, never invented. Only the common
 * single-target wildcard form (`"@/*": ["./src/*"]`) is understood;
 * anything else (no tsconfig, no `paths`, no matching pattern, a pattern
 * with more than one target, a non-wildcard pattern) returns `undefined` so
 * the caller fails clearly rather than guessing at a path that might not
 * be where the alias actually points.
 */
export function resolveAliasSpecifier(cwd: string, specifier: string): string | undefined {
  const config = readTsPathsConfig(cwd);
  if (!config) return undefined;

  for (const [pattern, targets] of Object.entries(config.paths)) {
    if (!pattern.endsWith("/*") || !Array.isArray(targets) || targets.length !== 1) continue;
    const target = targets[0];
    if (typeof target !== "string" || !target.endsWith("/*")) continue;
    const patternPrefix = pattern.slice(0, -1); // "@/*" -> "@/"
    if (!specifier.startsWith(patternPrefix)) continue;
    const rest = specifier.slice(patternPrefix.length);
    const targetPrefix = target.slice(0, -1); // "./src/*" -> "./src/", "./*" -> "./"
    return path.posix.normalize(path.posix.join(config.baseUrl, targetPrefix, rest));
  }
  return undefined;
}
