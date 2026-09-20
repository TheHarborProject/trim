// Trim CLI — loads Trim's own bundled TypeScript compiler. The CLI never
// touches a host project's installed `typescript` at all: a host may be on
// TypeScript 7, whose npm package is the native Go port and only exports
// `version`/`versionMajorMinor` — no JS compiler API (no `createSourceFile`,
// `createProgram`, `ScriptTarget`, ...) — which would crash every command
// here that needs real AST/type info. Bundling `@typescript/typescript6` as
// a real `dependencies` entry (see package.json) sidesteps that whole class
// of breakage, the same way a tool like ts-morph bundles its own compiler
// rather than deferring to a host's. `typescript` itself stays a
// devDependency only, used to build Trim's own `src/**`/`cli/**`.
//
// `import type * as TSModule from "@typescript/typescript6"` compiles to
// nothing at runtime, so it does not itself require the package to exist.
// The one runtime touchpoint is the `require()` below.

import type * as TSModule from "@typescript/typescript6";
import { UsageError } from "../dispatch";

export type TS = typeof TSModule;

/**
 * Throws UsageError (never an unhandled exception, never a silent
 * `undefined`) if the bundled compiler itself somehow fails to load — e.g.
 * a corrupted or incomplete install. That means Trim's own dependency is
 * broken, not something a host project did or can fix by installing
 * anything.
 */
export function loadTypeScript(): TS {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- deliberately dynamic; see this file's header.
    return require("@typescript/typescript6") as TS;
  } catch (error) {
    throw new UsageError(
      `could not load Trim's bundled TypeScript compiler (@typescript/typescript6): ${error instanceof Error ? error.message : String(error)}. This usually means node_modules is corrupted or incomplete — try reinstalling dependencies.`,
    );
  }
}
