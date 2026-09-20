// Trim CLI — the reusable helper for generated relative import specifiers.
// Generation-time only, never a runtime module-resolution mechanism: a
// generator calls this once, at the moment it writes a string into a file
// or prints a snippet. Nothing about Trim's own runtime resolves modules
// this way.

import path from "node:path";
import type { ModuleResolutionMode } from "./detect-project";

/**
 * Both arguments are project-root-relative, forward-slash, extensionless
 * paths (e.g. "trim/controls/theme.trim" and "src/lib/theme-store") — the
 * shape every generator in this CLI already works in. Uses `path.posix`
 * explicitly so the computed specifier is deterministic across OSes
 * (forward slashes), independent of the host platform's own separator.
 */
export function relativePathBetween(fromFileNoExt: string, toFileNoExt: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromFileNoExt), toFileNoExt);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/**
 * node16/nodenext require an explicit extension on a relative import, and
 * TypeScript's own convention there is the COMPILED extension (.js), even
 * though the real source file is .ts/.tsx — so `./trim/trim.config`
 * becomes `./trim/trim.config.js` there. Classic/bundler resolution
 * resolves an extensionless relative specifier fine (and bundler mode
 * actively rejects a literal .ts/.tsx extension), so extensionless is also
 * the correct choice there, not just the simpler one.
 */
export function relativeImportSpecifier(moduleResolution: ModuleResolutionMode, pathWithoutExtension: string): string {
  return moduleResolution === "node16-or-nodenext" ? `${pathWithoutExtension}.js` : pathWithoutExtension;
}
