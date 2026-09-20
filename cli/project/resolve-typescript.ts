// Trim CLI — resolves the HOST PROJECT's own installed `typescript`, never
// a copy Trim ships itself. Trim's package.json keeps `typescript` as a
// devDependency only (used to build Trim itself) — it is NOT a runtime
// dependency of the published package, and this module never makes it one:
// `require.resolve("typescript", { paths: [cwd] })` looks specifically in
// the HOST project's own node_modules resolution chain, the same way a
// tool like ESLint or Prettier defers to a project's own installed
// compiler rather than bundling one. A TypeScript-only workflow (already
// required by `trim init`/`trim new control`) can be expected to have one;
// `trim attach`, which needs real structural parsing of trim.config.tsx,
// fails clearly when it doesn't rather than silently falling back to a
// weaker (regex-based) parsing strategy.
//
// `import type` only for the actual `typescript` types — this compiles to
// nothing at runtime, so it does not itself require the package to exist.
// The one runtime touchpoint is the dynamic `require()` below, resolved
// from the host project's location, not this file's own.

import type * as TSModule from "typescript";

export type TS = typeof TSModule;

export function resolveHostTypeScript(cwd: string): TS | undefined {
  try {
    const resolvedPath = require.resolve("typescript", { paths: [cwd] });
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- deliberately dynamic; see this file's header.
    return require(resolvedPath) as TS;
  } catch {
    return undefined;
  }
}
