// Trim CLI — advisory checks for a "project binding" import: does the
// target path resolve to something on disk, and does the named symbol
// look like it's exported from it. Explicitly advisory, per the agreed
// binding-wizard philosophy: "validate: target path can reasonably
// resolve; symbol appears to be exported. This is advisory, not a full
// TypeScript compiler guarantee." Path resolution is a hard gate (an
// import to a path that doesn't exist at all is indistinguishable from
// inventing a binding); the symbol check is soft (a plain textual scan has
// real blind spots — re-exports, barrels, computed exports — so a miss is
// reported, never silently treated as failure).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CANDIDATE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

/** Returns the resolved absolute path if `importPath` (relative to `cwd`) plausibly resolves to a real file, else undefined. */
export function resolveImportTarget(cwd: string, importPath: string): string | undefined {
  const cleaned = importPath.replace(/^\.\/+/, "");
  const base = path.join(cwd, cleaned);
  for (const ext of CANDIDATE_EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  for (const ext of CANDIDATE_EXTENSIONS) {
    const indexPath = path.join(base, "index" + ext);
    if (existsSync(indexPath)) return indexPath;
  }
  return existsSync(base) ? base : undefined;
}

/** A best-effort textual scan — false negatives are expected for re-exports/barrels/computed exports. Advisory only. */
export function symbolAppearsExported(filePath: string, symbol: string): boolean {
  try {
    const source = readFileSync(filePath, "utf8");
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`export\\s+(const|function|class|let|var)\\s+${escaped}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`),
    ];
    return patterns.some((p) => p.test(source));
  } catch {
    return false;
  }
}
