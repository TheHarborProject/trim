// Trim CLI — host project discovery. Environment discovery only (package
// manager, TS/JS, tsconfig, shadcn presence, a likely global stylesheet) —
// NOT the future `trim detect`'s application-state scan. Everything here
// is read-only: no file is ever written by this module.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/**
 * Only the distinction generated relative-import specifiers actually care
 * about (see ./module-resolution.ts) — not the full set of TypeScript's
 * moduleResolution values.
 */
export type ModuleResolutionMode = "node16-or-nodenext" | "classic-or-bundler";

export type ProjectInfo = {
  cwd: string;
  isTypeScript: boolean;
  tsconfigPath: string | undefined;
  moduleResolution: ModuleResolutionMode;
  packageManager: PackageManager;
  /** True only when a components.json exists at the project root — the standard marker shadcn/ui's own CLI creates. */
  shadcnConfigured: boolean;
  /** Project-relative path to a plausible global stylesheet, if one of a short list of common conventions exists. */
  globalStylesheet: string | undefined;
  /** Semantic CSS custom-property names (without the "--" prefix) found declared in `globalStylesheet`, limited to a small known set. */
  identifiedProjectTokens: readonly string[];
};

function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

/**
 * A small hand-written tokenizer, not a naive "strip everything after two
 * slashes" regex: tsconfig.json commonly has a top-level "$schema" field
 * whose URL value itself contains two slashes, which a naive strip would
 * truncate mid-string and corrupt the JSON. This tracks string/escape
 * state so only real comments (outside strings) are stripped, then
 * removes trailing commas.
 */
export function stripJsonComments(source: string): string {
  let result = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        result += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      result += ch;
      if (ch === "\\") {
        result += next;
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    result += ch;
  }
  return result.replace(/,(\s*[}\]])/g, "$1");
}

function readModuleResolution(tsconfigPath: string): ModuleResolutionMode {
  try {
    const parsed = JSON.parse(stripJsonComments(readFileSync(tsconfigPath, "utf8")));
    const value = String(parsed?.compilerOptions?.moduleResolution ?? "").toLowerCase();
    return value === "node16" || value === "nodenext" ? "node16-or-nodenext" : "classic-or-bundler";
  } catch {
    // Malformed or unreadable tsconfig.json: fall back to the resolution
    // mode that keeps generated extensionless imports working, the more
    // common case by far.
    return "classic-or-bundler";
  }
}

const GLOBAL_STYLESHEET_CANDIDATES = [
  "src/app/globals.css",
  "app/globals.css",
  "src/styles/globals.css",
  "styles/globals.css",
  "src/index.css",
  "src/App.css",
];

function findGlobalStylesheet(cwd: string): string | undefined {
  return GLOBAL_STYLESHEET_CANDIDATES.find((candidate) => existsSync(path.join(cwd, candidate)));
}

// Not shadcn detection (that's components.json alone) — a narrow signal
// for the styling question's "project design tokens" choice: do we know
// concrete variable names to map --trim-* onto, or not.
const KNOWN_TOKEN_NAMES = ["background", "foreground", "muted-foreground", "border", "radius"];

function identifyProjectTokens(cwd: string, globalStylesheet: string | undefined): string[] {
  if (!globalStylesheet) return [];
  try {
    const css = readFileSync(path.join(cwd, globalStylesheet), "utf8");
    return KNOWN_TOKEN_NAMES.filter((name) => new RegExp(`--${name}\\s*:`).test(css));
  } catch {
    return [];
  }
}

export function detectProject(cwd: string): ProjectInfo {
  const tsconfigCandidate = path.join(cwd, "tsconfig.json");
  const tsconfigPath = existsSync(tsconfigCandidate) ? tsconfigCandidate : undefined;
  const globalStylesheet = findGlobalStylesheet(cwd);
  return {
    cwd,
    isTypeScript: tsconfigPath !== undefined,
    tsconfigPath,
    moduleResolution: tsconfigPath ? readModuleResolution(tsconfigPath) : "classic-or-bundler",
    packageManager: detectPackageManager(cwd),
    shadcnConfigured: existsSync(path.join(cwd, "components.json")),
    globalStylesheet,
    identifiedProjectTokens: identifyProjectTokens(cwd, globalStylesheet),
  };
}
