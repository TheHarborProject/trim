// Trim CLI — shared prompt helpers used by more than one wizard (currently
// cli/prompts/init-prompts.ts, cli/prompts/new-control-prompts.ts, and
// cli/prompts/attach-prompts.ts). Kept separate from any one wizard so none
// of them depends on another for a small, reused piece of logic.
//
// Every helper here enforces the same rule: empty input may accept a
// DOCUMENTED default (shown in the prompt text itself, e.g. "(default)" or
// an explicit [Y/n] suffix) — but invalid, non-empty input is never
// silently treated as that default. It reprompts instead, relying on the
// underlying Ask itself to fail rather than loop forever once real input
// is exhausted (see init-prompts.ts's header for why that's a real,
// verified property of the readline-backed Ask, not an assumption).

export type Ask = (promptText: string) => Promise<string>;

function parseOneIndexedChoice(answer: string, count: number): number | undefined {
  const index = Number(answer) - 1;
  return Number.isInteger(index) && index >= 0 && index < count ? index : undefined;
}

/**
 * A numbered-menu question with a real, documented default: blank input
 * returns `defaultIndex` (0-indexed); a valid 1-indexed choice returns it
 * (0-indexed); anything else reprompts.
 */
export async function askChoiceWithDefault(ask: Ask, promptText: string, count: number, defaultIndex: number): Promise<number> {
  while (true) {
    const answer = (await ask(promptText)).trim();
    if (answer === "") return defaultIndex;
    const index = parseOneIndexedChoice(answer, count);
    if (index !== undefined) return index;
    console.log(`Please enter a number from 1 to ${count}, or press Enter for the default.`);
  }
}

/**
 * A numbered-menu question with NO sensible default — every answer,
 * including a blank one, must be an explicit valid choice. Used where
 * picking a default on the user's behalf (Trim-managed vs. a project
 * binding; which group to attach to) would be a meaningful, potentially
 * surprising decision, not a harmless convenience.
 */
export async function askRequiredChoice(ask: Ask, promptText: string, count: number): Promise<number> {
  while (true) {
    const answer = (await ask(promptText)).trim();
    const index = parseOneIndexedChoice(answer, count);
    if (index !== undefined) return index;
    console.log(`Please enter a number from 1 to ${count}.`);
  }
}

/** A yes/no question with a documented default (the [Y/n]/[y/N] suffix): blank returns `defaultYes`; y/yes or n/no return the obvious boolean; anything else reprompts. */
export async function askYesNo(ask: Ask, question: string, defaultYes: boolean): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  while (true) {
    const answer = (await ask(`${question} ${suffix} `)).trim().toLowerCase();
    if (answer === "") return defaultYes;
    if (answer === "y" || answer === "yes") return true;
    if (answer === "n" || answer === "no") return false;
    console.log("Please answer y or n (or press Enter for the default).");
  }
}
