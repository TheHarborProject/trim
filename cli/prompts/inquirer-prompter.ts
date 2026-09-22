// Trim CLI — the real, interactive `Prompter` (cli/prompts/prompter.ts),
// backed by @inquirer/prompts.
//
// @inquirer/prompts is ESM-only; this CLI still builds as CommonJS
// (tsconfig.cli.json — module: "commonjs", deliberately not changed for
// this migration).
//
// A static `import ... from "@inquirer/prompts"` compiles to a `require()`,
// which fails loading an ESM-only package on any Node that doesn't support
// `require(esm)` (stable only since Node 22.12/23 — this package's own
// engines field says ">=18.17"). A plain dynamic `import(...)` doesn't fix
// this on its own either: TypeScript, targeting CommonJS, downlevels
// `import(...)` to `Promise.resolve().then(() => require(...))` — same
// `require()` underneath, same failure on an older Node, just deferred to a
// microtask (verified empirically against this exact build; see this
// migration's own notes).
//
// The fix is to keep TypeScript from ever seeing this as a dynamic-import
// *expression* it's allowed to rewrite: building the `import()` call from a
// string via `new Function(...)` at runtime. `tsc` only transforms syntax
// it parses, so the string's contents are opaque to it and reach Node
// verbatim as `import(...)` — a real ESM import, evaluated by Node itself,
// which every Node version in this package's supported range (>=18.17)
// supports.
//
// The module is loaded once and cached: every wizard prompts several times
// per run, and there's no reason to pay the dynamic-import cost more than
// once per process.

import type { Prompter } from "./prompter";

type InquirerModule = typeof import("@inquirer/prompts");

// eslint-disable-next-line @typescript-eslint/no-implied-eval -- deliberate: see header above.
const importInquirerPrompts = new Function("return import('@inquirer/prompts')") as () => Promise<InquirerModule>;

let modulePromise: Promise<InquirerModule> | undefined;
function loadInquirer(): Promise<InquirerModule> {
  if (!modulePromise) modulePromise = importInquirerPrompts();
  return modulePromise;
}

export const inquirerPrompter: Prompter = {
  async input(opts) {
    const { input } = await loadInquirer();
    return input({ message: opts.message, default: opts.default, validate: opts.validate });
  },

  async select<T>(opts: { message: string; choices: { name: string; value: T; checked?: boolean }[]; default?: T }): Promise<T> {
    const { select } = await loadInquirer();
    return select<T>({ message: opts.message, choices: opts.choices, default: opts.default });
  },

  async confirm(opts) {
    const { confirm } = await loadInquirer();
    return confirm({ message: opts.message, default: opts.default });
  },

  async checkbox<T>(opts: { message: string; choices: { name: string; value: T; checked?: boolean }[] }): Promise<T[]> {
    const { checkbox } = await loadInquirer();
    return checkbox<T>({ message: opts.message, choices: opts.choices });
  },
};
