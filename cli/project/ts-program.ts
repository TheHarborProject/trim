// Trim CLI — builds a host TypeScript Program for `trim detect`'s static
// analysis. Reuses the exact same host-compiler-resolution technique as
// cli/project/resolve-typescript.ts (trim attach's own infrastructure) —
// never a bundled/second TypeScript, never ts-morph, never runtime
// reflection over require()'d modules.
//
// One-shot: builds exactly one ts.Program and one ts.TypeChecker per
// `trim detect` invocation. No watcher, no incremental build info, no
// language server — a CLI-time scan, not a daemon (see this step's own
// spec, section 2).

import path from "node:path";
import { resolveHostTypeScript, type TS } from "./resolve-typescript";
import { UsageError } from "../dispatch";

export type HostProgram = {
  tsc: TS;
  program: import("typescript").Program;
  checker: import("typescript").TypeChecker;
  /**
   * Absolute paths of exactly the files the host's OWN tsconfig
   * include/exclude/files graph resolves to — the scan boundary.
   * program.getSourceFiles() additionally pulls in every transitively
   * referenced .d.ts (lib files, node_modules types), which are
   * deliberately NOT part of this set; see detect-bindings.ts's own
   * filtering for why only these are ever scanned.
   */
  rootFileNames: readonly string[];
  tsconfigPath: string;
};

/** Throws UsageError for both failure modes this step calls out explicitly: no resolvable TypeScript compiler, and an unparseable tsconfig.json. */
export function buildHostProgram(cwd: string): HostProgram {
  const tsc = resolveHostTypeScript(cwd);
  if (!tsc) {
    throw new UsageError(
      "could not resolve a TypeScript compiler from this project (no `typescript` package found via this project's own node_modules). " +
        "trim detect needs it to safely analyze your project — install `typescript` in this project and try again.",
    );
  }

  const tsconfigPath = tsc.findConfigFile(cwd, (f) => tsc.sys.fileExists(f), "tsconfig.json");
  if (!tsconfigPath) {
    throw new UsageError("could not find a tsconfig.json in this project (or any parent directory) — trim detect requires a TypeScript project.");
  }

  const configFile = tsc.readConfigFile(tsconfigPath, tsc.sys.readFile);
  if (configFile.error) {
    throw new UsageError(`could not parse ${path.relative(cwd, tsconfigPath)}: ${tsc.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`);
  }

  const parsed = tsc.parseJsonConfigFileContent(configFile.config, tsc.sys, path.dirname(tsconfigPath));
  if (parsed.errors.length > 0) {
    throw new UsageError(`could not parse ${path.relative(cwd, tsconfigPath)}: ${tsc.flattenDiagnosticMessageText(parsed.errors[0].messageText, "\n")}`);
  }

  const program = tsc.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();

  return { tsc, program, checker, rootFileNames: parsed.fileNames, tsconfigPath };
}
