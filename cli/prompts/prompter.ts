// Trim CLI — the `Prompter` seam every wizard prompts through instead of
// calling @inquirer/prompts (or readline) directly.
//
// Production code wires the real, @inquirer/prompts-backed implementation
// (./inquirer-prompter.ts) at the one real entry point (cli/dispatch.ts /
// cli/bin/trim.ts); every command function takes a `Prompter` as a plain
// parameter instead, so tests can inject a scripted fake — an object whose
// four methods resolve from a canned queue of answers — with no TTY/stdin
// involved at all. Same shape for every wizard (init, new control, attach,
// detect): one seam instead of the two the CLI used to have (init's
// whole-object `PromptForAnswers` vs. everyone else's per-question `Ask`).

export type Choice<T> = { name: string; value: T; checked?: boolean };

export interface Prompter {
  input(opts: { message: string; default?: string; validate?: (v: string) => true | string }): Promise<string>;
  select<T>(opts: { message: string; choices: Choice<T>[]; default?: T }): Promise<T>;
  confirm(opts: { message: string; default?: boolean }): Promise<boolean>;
  checkbox<T>(opts: { message: string; choices: Choice<T>[] }): Promise<T[]>;
}

/**
 * Ctrl+C during any @inquirer/prompts prompt rejects with an
 * `ExitPromptError` — a class @inquirer/core defines and every individual
 * prompt (input/select/confirm/checkbox/...) throws, but which
 * @inquirer/prompts's own top-level entry point does not re-export. Detected
 * here by duck-typing `.name` instead of importing the class: that keeps
 * this file (and its caller, cli/dispatch.ts) free of any dependency on
 * @inquirer's ESM-only packages — only cli/prompts/inquirer-prompter.ts ever
 * imports them, and only via a dynamic `import()`, per that file's header.
 */
export function isExitPromptError(error: unknown): boolean {
  return error instanceof Error && error.name === "ExitPromptError";
}
