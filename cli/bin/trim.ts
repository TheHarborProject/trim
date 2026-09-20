#!/usr/bin/env node
// Trim CLI entry point. Published as the package's `trim` bin
// (package.json's "bin" field) — resolvable as `npx trim ...` once this
// package is installed locally, or `npx @theharborproject/trim init` for
// the very first, zero-install bootstrap.

import { runCli, type CommandTable } from "../dispatch";
import { initCommand } from "../commands/init";
import { addCommand } from "../commands/add";
import { detectCommand } from "../commands/detect";
import { newControlCommand } from "../commands/new-control";
import { attachCommand } from "../commands/attach";

const commands: CommandTable = {
  init: initCommand,
  add: addCommand,
  detect: detectCommand,
  "new-control": newControlCommand,
  attach: attachCommand,
};

runCli(process.argv.slice(2), commands).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  },
);
