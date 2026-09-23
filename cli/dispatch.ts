// Trim CLI — command dispatch. Infrastructure only: parsing, help, and
// routing to a command module. No command's actual behavior lives here —
// see ./commands/*.ts, each currently a "not implemented yet" stub.
//
// Deliberately hand-written, not built on a CLI-parsing library: five
// commands, one with a two-token name ("new control"), positional
// arguments only, no flags beyond --help. A library earns its dependency
// weight once real option parsing (multi-value flags, prompts) is needed —
// not before.

import { isExitPromptError } from "./prompts/prompter";

/**
 * Any expected, non-crash command failure meant to be printed cleanly
 * (no stack trace) and end the process with exit code 1 — bad invocation
 * (missing argument, unknown option) as well as a real precondition a
 * command's own logic detected and needs the user to address (e.g. `trim
 * init` finding conflicting existing files). Anything else thrown by a
 * command is treated as unexpected and surfaces with its full stack.
 */
export class UsageError extends Error {}

export type CommandHandler = (args: readonly string[]) => Promise<void> | void;

const HELP = `Trim

Usage:
  trim <command>

Commands:
  init
  add <ref>
  example <name>   Copy a registry example into ./<name>
  detect   Find existing state that can be safely integrated with Trim
  new control <id>
  attach <control-id>

Examples:
  trim init
  trim add @default/example
  trim example shadcn
  trim new control reduced-motion
  trim attach reduced-motion
  trim detect
`;

/**
 * "new control <id>" is the one nested command name in the current
 * surface: its first two tokens are both literal words, not a command
 * followed by a positional argument. Everything else is
 * "<command> <...args>".
 */
function parseCommandName(argv: readonly string[]): { name: string; rest: readonly string[] } {
  if (argv[0] === "new" && argv[1] === "control") {
    return { name: "new-control", rest: argv.slice(2) };
  }
  return { name: argv[0], rest: argv.slice(1) };
}

export type CommandTable = Readonly<Record<string, CommandHandler>>;

/**
 * Returns a process exit code — never calls process.exit() itself, so
 * ./bin/trim.ts (or a test) stays in control of the actual process
 * lifecycle. 0 for "recognized and dispatched" (including a command that
 * is honestly still a stub), 1 for anything that means the invocation
 * itself was wrong (unknown command, missing required argument).
 */
export async function runCli(argv: readonly string[], commands: CommandTable): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  const { name, rest } = parseCommandName(argv);
  const command = commands[name];
  if (!command) {
    process.stderr.write(`trim: unknown command "${argv[0]}"\n\n`);
    process.stderr.write(HELP);
    return 1;
  }

  try {
    await command(rest);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`trim: ${error.message}\n`);
      return 1;
    }
    // Ctrl+C during any @inquirer/prompts prompt — the single outermost
    // point every command's execution errors already pass through. Printed
    // clean (no stack trace) and given the SAME exit-code convention an
    // explicit in-menu "Cancel" choice already uses: those never throw,
    // they print their own "Cancelled — ..." line and return normally, so
    // the command resolves and this function returns 0 — never the 1
    // UsageError gets. Ctrl+C matches that: it's a deliberate cancellation,
    // not a usage error.
    if (isExitPromptError(error)) {
      console.log("Trim cancelled.");
      return 0;
    }
    throw error;
  }
}
