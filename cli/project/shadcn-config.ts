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

/** The three real shadcn primitive backends. A fourth state, "genuinely undetectable", is expressed as `undefined` on ShadcnSetup.backend rather than a 4th member here — see that field's own doc. */
export type ShadcnBackend = "radix" | "base" | "aria";

export type ShadcnSetup = {
  /** Raw alias map from components.json's own "aliases" object, e.g. { ui: "@/components/ui", components: "@/components", ... }. Only string values are kept. */
  aliases: Readonly<Record<string, string>>;
  /**
   * Which primitive library the project's shadcn components are actually
   * built on — CLI-time detection only (never a runtime concern; Trim's
   * own runtime has no idea shadcn exists at all). `undefined` means
   * genuinely undetectable: neither signal below was conclusive. Callers
   * that need to KNOW the backend to generate correct composition syntax
   * (./shadcn-shell.ts's popover/dialog shells) must refuse rather than
   * guess when this is `undefined` or `"aria"` (not yet supported) — see
   * that module. Callers that don't care (shadcn-registry.ts's control
   * templates, which never wrap a Button in a Trigger) simply ignore it.
   *
   * Detection, in priority order:
   *  1. components.json's own "style" field, current shadcn CLI
   *     convention: "{library}-{styleName}" with library one of
   *     radix|base|aria (e.g. "base-vega") is authoritative. A "style"
   *     value with no recognized prefix that IS one of the known legacy
   *     values ("default", "new-york", "new-york-v4") is also
   *     authoritative — treated as radix, back-compat, matching shadcn's
   *     own getBase logic ("unprefixed legacy values stay radix"). A
   *     "style" value that is neither is genuinely ambiguous, so it falls
   *     through to signal 2, same as a missing "style" key entirely (this
   *     module never guesses "base" for a brand-new/unrecognized value the
   *     way shadcn's OWN CLI does when scaffolding a fresh project — this
   *     is an EXISTING project's config, not a fresh scaffold).
   *  2. Fallback: resolve the project's actual installed popover.tsx (then
   *     dialog.tsx, then button.tsx, first one found) via the same
   *     alias-resolution machinery as everything else in this file, and
   *     grep its import statements for a recognized primitive package
   *     ("radix-ui" / "@radix-ui/react-*" -> radix; "@base-ui/react/*" or
   *     the older "@base-ui-components/react" package name -> base).
   *  3. Neither conclusive -> `undefined`.
   */
  backend: ShadcnBackend | undefined;
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

  const rawStyle = (parsed as { style?: unknown }).style;
  const style = typeof rawStyle === "string" ? rawStyle : undefined;
  const backend = detectShadcnBackend(cwd, style, aliases.ui);

  return { aliases, backend };
}

const KNOWN_STYLE_PREFIXES = new Set<ShadcnBackend>(["radix", "base", "aria"]);
/** shadcn's own back-compat set — see ShadcnSetup.backend's own doc. */
const LEGACY_RADIX_STYLE_VALUES = new Set(["default", "new-york", "new-york-v4"]);

/** Signal 1 (components.json "style") then signal 2 (grep an installed primitive's imports) — see ShadcnSetup.backend's own doc for the exact algorithm. */
function detectShadcnBackend(cwd: string, style: string | undefined, uiAlias: string | undefined): ShadcnBackend | undefined {
  if (style !== undefined) {
    const prefix = style.split("-")[0];
    if (KNOWN_STYLE_PREFIXES.has(prefix as ShadcnBackend)) return prefix as ShadcnBackend;
    if (LEGACY_RADIX_STYLE_VALUES.has(style)) return "radix";
    // present but unrecognized (neither a known prefix nor a known legacy
    // value) -> signal 1 is inconclusive, fall through to signal 2, same as
    // an absent "style" key entirely.
  }
  return detectShadcnBackendFromInstalledFiles(cwd, uiAlias);
}

const BASE_UI_IMPORT_RE = /from\s*["']@base-ui(?:-components)?\/react(?:\/[\w-]+)?["']/;
const RADIX_IMPORT_RE = /from\s*["'](?:radix-ui|@radix-ui\/react-[\w-]+)["']/;

/** Reads (never writes) whichever of popover.tsx/dialog.tsx/button.tsx resolves first, via the exact same alias-resolution machinery as everything else in this file — never a second, subtly-different guessing mechanism. */
function detectShadcnBackendFromInstalledFiles(cwd: string, uiAlias: string | undefined): ShadcnBackend | undefined {
  if (!uiAlias) return undefined;
  for (const fileBaseName of ["popover", "dialog", "button"]) {
    const resolvedRelPath = resolveAliasSpecifier(cwd, `${uiAlias}/${fileBaseName}`);
    if (!resolvedRelPath) continue;
    const source = readComponentSourceSync(cwd, resolvedRelPath);
    if (source === undefined) continue;
    if (BASE_UI_IMPORT_RE.test(source)) return "base";
    if (RADIX_IMPORT_RE.test(source)) return "radix";
  }
  return undefined;
}

function readComponentSourceSync(cwd: string, relativePathNoExt: string): string | undefined {
  for (const ext of [".tsx", ".ts", ".jsx", ".js"]) {
    const fullPath = path.join(cwd, `${relativePathNoExt}${ext}`);
    if (existsSync(fullPath)) {
      try {
        return readFileSync(fullPath, "utf8");
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
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
