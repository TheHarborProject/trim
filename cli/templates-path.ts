// Trim CLI — resolves this package's OWN bundled template files (never a
// remote registry, never the host project's files). `trim add` copies code
// from here into the host project, which owns it from that point on.
//
// TEMPLATES_ROOT is computed relative to *this compiled module's own
// location* (`__dirname`), not `cwd` (the host project) and not a path
// baked in at repo-source time: once this file compiles to
// dist/cli/templates-path.js, `__dirname` is `<package>/dist/cli` —
// whether that package root is this repo (during tests, which run against
// the real `dist/` build) or a real `node_modules/@theharborproject/trim`
// install. Templates live at `dist/cli/templates/**`, built by copying
// `cli/templates/**` verbatim (see package.json's build script): these
// are never run through `tsc` themselves, since the whole point is to copy
// their exact source TEXT into a host project, not a compiled artifact.
import { readFileSync } from "node:fs";
import path from "node:path";

export const TEMPLATES_ROOT = path.join(__dirname, "templates");

export function readTemplate(relativePath: string): string {
  return readFileSync(path.join(TEMPLATES_ROOT, relativePath), "utf8");
}
