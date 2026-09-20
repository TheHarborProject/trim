// Trim CLI — the real, interactive `trim init` prompts. A thin adapter:
// all it does is turn two questions into an `InitAnswers`, using Node's
// built-in `readline/promises` (available since Node 18, already this
// package's minimum). No prompt dependency was added — two yes/no-ish
// questions with a handful of options don't justify one; this is the same
// "check whether a tiny handwritten parser is sufficient" call already
// made for command dispatch, applied to prompting.
//
// cli/commands/init.ts's `runInitCommand` never calls this directly — it
// takes a `promptForAnswers` function, so tests can supply predetermined
// answers with no TTY at all.
//
// Reads lines via the readline interface's async-iterator form, not
// sequential `rl.question()` calls: verified empirically that
// `node:readline/promises`'s `question()` does not reliably resolve a
// SECOND time once the underlying stdin stream has already reached EOF —
// which piped (non-TTY) input does immediately, as soon as all of it has
// been written. The async-iterator form doesn't have this problem: it
// correctly yields every already-buffered line regardless of how many
// were queued before the first read, which is exactly the shape a piped
// answer file (or a test) produces.

import { createInterface } from "node:readline/promises";
import type { ProjectInfo } from "../project/detect-project";
import type { InitAnswers, Styling } from "../generators/init-files";
import { askChoiceWithDefault, askYesNo, type Ask } from "./prompt-utils";

const STYLING_OPTIONS: readonly Styling[] = ["default", "tokens", "headless"];

async function promptStyling(ask: Ask): Promise<Styling> {
  const index = await askChoiceWithDefault(
    ask,
    "How should Trim be styled?\n" +
      "  1) Use Trim default theme (default)\n" +
      "  2) Use project design tokens\n" +
      "  3) Fully headless\n" +
      "> ",
    STYLING_OPTIONS.length,
    0,
  );
  return STYLING_OPTIONS[index];
}

export async function collectInitAnswers(project: ProjectInfo): Promise<InitAnswers> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  const ask: Ask = async (promptText) => {
    process.stdout.write(promptText);
    const { value, done } = await lines.next();
    return done ? "" : value;
  };
  try {
    // "require the prerequisite before accepting Yes": the question is
    // never even asked when shadcn isn't configured, so `useShadcn: true`
    // can never come from someone mistakenly answering "y" to a question
    // that had no real "yes" available — see init-files.ts's own
    // defense-in-depth check for the case a caller bypasses this prompt
    // entirely (a test, a future non-interactive mode).
    let useShadcn = false;
    if (project.shadcnConfigured) {
      useShadcn = await askYesNo(ask, "Use shadcn components for generated Trim controls?", true);
    } else {
      process.stdout.write(
        "shadcn does not appear to be configured in this project (no components.json found) — skipping that question.\n" +
          "Set it up first (https://ui.shadcn.com/docs/installation) and re-run `trim init` to enable it.\n",
      );
    }
    const styling = await promptStyling(ask);
    return { useShadcn, styling };
  } finally {
    rl.close();
  }
}
