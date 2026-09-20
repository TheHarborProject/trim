// Compiles the exact src/** files the benchmarks need, once, into a scratch
// directory — same tsc-then-require pattern tests/*.mjs already use, so
// tsc/startup cost is paid once per benchmark run, not once per measurement
// (per the brief's "avoid microbenchmarks dominated by startup/tsc cost").
// Read-only with respect to src/**: this never writes there.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..", "..");

export function compileTrim() {
  const dir = mkdtempSync(path.join(root, ".trim-benchmark-"));
  execFileSync(
    "node",
    [
      "node_modules/typescript/bin/tsc",
      "src/types.ts",
      "src/core/settings.ts",
      "src/core/controller-engine.ts",
      "src/core/controller.ts",
      "src/core/bindings.ts",
      "src/core/registry.ts",
      "src/core/integration.ts",
      "src/react/controller.ts",
      "src/react/registry-context.ts",
      "src/react/components.tsx",
      "src/advanced/resolution.ts",
      "src/advanced/sorting.ts",
      "--outDir",
      dir,
      "--module",
      "commonjs",
      "--target",
      "es2020",
      "--jsx",
      "react-jsx",
      "--skipLibCheck",
    ],
    { cwd: root },
  );
  const require = createRequire(import.meta.url);
  const mods = {
    React: require("react"),
    controllerEngine: require(path.join(dir, "core", "controller-engine.js")),
    coreController: require(path.join(dir, "core", "controller.js")),
    reactController: require(path.join(dir, "react", "controller.js")),
    bindings: require(path.join(dir, "core", "bindings.js")),
    registry: require(path.join(dir, "core", "registry.js")),
    components: require(path.join(dir, "react", "components.js")),
    resolution: require(path.join(dir, "advanced", "resolution.js")),
    sorting: require(path.join(dir, "advanced", "sorting.js")),
  };
  return { dir, mods, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
