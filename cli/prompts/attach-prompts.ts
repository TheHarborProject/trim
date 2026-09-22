// Trim CLI — the real, interactive `trim attach` prompts, through the
// shared `Prompter` seam (cli/prompts/prompter.ts) — same pattern as every
// other wizard, so tests can inject a scripted fake `Prompter` with no TTY
// at all.

import { isValidControlId, suggestControlId, suggestControlLabel } from "../project/control-id";
import type { Choice, Prompter } from "./prompter";
import type { AttachInfo, AttachAnswers } from "../generators/attach-plan";
import { UsageError } from "../dispatch";

/** Keeps today's throw-on-invalid-id behavior — no `validate:` reprompt. */
async function collectNewGroupAnswers(prompter: Prompter): Promise<{ groupId: string; groupLabel: string }> {
  const groupId = (await prompter.input({ message: "Group id:" })).trim();
  if (!isValidControlId(groupId)) {
    const suggestion = suggestControlId(groupId);
    throw new UsageError(`"${groupId}" is not a valid group id — use kebab-case (lowercase letters, digits, hyphens), e.g. "${suggestion || "my-group"}".`);
  }
  const suggestion = suggestControlLabel(groupId);
  const groupLabel = (await prompter.input({ message: "Group label:", default: suggestion })).trim() || suggestion;
  return { groupId, groupLabel };
}

const CREATE_NEW_GROUP = Symbol("create-new-group");

/**
 * `Attach to:` lists every existing group plus "+ Create new group". Groups
 * are addressed by their own (already-unique) id; the "create new" choice
 * uses a distinct symbol value so it can never collide with a real group id.
 */
export async function collectAttachAnswers(info: AttachInfo, prompter: Prompter): Promise<AttachAnswers> {
  const groups = info.parsed.groups;
  const groupChoices: Choice<string | typeof CREATE_NEW_GROUP>[] = groups.map((g) => ({
    name: g.label ? `${g.label} (${g.id})` : g.id,
    value: g.id,
  }));
  groupChoices.push({ name: "+ Create new group", value: CREATE_NEW_GROUP });

  const choice = await prompter.select<string | typeof CREATE_NEW_GROUP>({ message: "Attach to:", choices: groupChoices });

  if (choice === CREATE_NEW_GROUP) {
    const { groupId, groupLabel } = await collectNewGroupAnswers(prompter);
    return { mode: "new-group", groupId, groupLabel };
  }

  const group = groups.find((g) => g.id === choice)!;
  if (group.items.length === 0) {
    // Nothing to be "before" or "after" yet — append is the only sensible position.
    return { mode: "existing-group", groupId: group.id, position: "append" };
  }

  const positionChoice = await prompter.select<"append" | "before" | "after">({
    message: "Position:",
    choices: [
      { name: "Append", value: "append" },
      { name: "Before an existing control", value: "before" },
      { name: "After an existing control", value: "after" },
    ],
    default: "append",
  });
  if (positionChoice === "append") {
    return { mode: "existing-group", groupId: group.id, position: "append" };
  }

  const itemChoices: Choice<string>[] = group.items.map((item) => ({ name: item.ref, value: item.ref }));
  const targetRef = await prompter.select<string>({ message: "Which control?", choices: itemChoices });

  return { mode: "existing-group", groupId: group.id, position: positionChoice === "before" ? { before: targetRef } : { after: targetRef } };
}
