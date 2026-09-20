// Trim CLI — the real, interactive `trim attach` prompts. Same technique
// as the other wizards: readline's async-iterator form for the real,
// stdin-backed Ask (see init-prompts.ts's header for the verified reason),
// and a plain `Ask` function signature so tests can inject a scripted one.

import { isValidControlId, suggestControlId, suggestControlLabel } from "../project/control-id";
import { askChoiceWithDefault, askRequiredChoice, type Ask } from "./prompt-utils";
import type { AttachInfo, AttachAnswers } from "../generators/attach-plan";
import { UsageError } from "../dispatch";

export type { Ask };

async function collectNewGroupAnswers(ask: Ask): Promise<{ groupId: string; groupLabel: string }> {
  const groupId = (await ask("Group id: ")).trim();
  if (!isValidControlId(groupId)) {
    const suggestion = suggestControlId(groupId);
    throw new UsageError(`"${groupId}" is not a valid group id — use kebab-case (lowercase letters, digits, hyphens), e.g. "${suggestion || "my-group"}".`);
  }
  const suggestion = suggestControlLabel(groupId);
  const groupLabel = (await ask(`Group label: [${suggestion}] `)).trim() || suggestion;
  return { groupId, groupLabel };
}

/**
 * `Attach to:` lists every existing group plus "+ Create new group" — no
 * default: which group a control lands in (or that a new one is created)
 * is a real decision, so every answer, including blank, must be an
 * explicit choice. (Previously any unmatched input, including no groups
 * existing at all, silently meant "create new group" — an unintentional
 * side effect of the old permissive parser, not a deliberate default.)
 */
export async function collectAttachAnswers(info: AttachInfo, ask: Ask): Promise<AttachAnswers> {
  const groups = info.parsed.groups;
  const groupLines = groups.map((g, i) => `  ${i + 1}) ${g.label ?? g.id}${g.label ? ` (${g.id})` : ""}`);
  const createIndex = groups.length;
  const createLine = `  ${createIndex + 1}) + Create new group`;
  const choice = await askRequiredChoice(ask, `Attach to:\n${[...groupLines, createLine].join("\n")}\n> `, groups.length + 1);

  if (choice === createIndex) {
    const { groupId, groupLabel } = await collectNewGroupAnswers(ask);
    return { mode: "new-group", groupId, groupLabel };
  }

  const group = groups[choice];
  if (group.items.length === 0) {
    // Nothing to be "before" or "after" yet — append is the only sensible position.
    return { mode: "existing-group", groupId: group.id, position: "append" };
  }

  // Append has a real, documented default (blank or "1"); "2"/"3" pick
  // before/after explicitly; anything else reprompts.
  const positionChoice = await askChoiceWithDefault(ask, "Position:\n  1) Append (default)\n  2) Before an existing control\n  3) After an existing control\n> ", 3, 0);
  if (positionChoice === 0) {
    return { mode: "existing-group", groupId: group.id, position: "append" };
  }

  // No default here: which existing control to position relative to is a
  // real choice — previously unmatched input silently meant the first item,
  // another unintentional side effect of the old permissive parser.
  const itemLines = group.items.map((item, i) => `  ${i + 1}) ${item.ref}`).join("\n");
  const targetIndex = await askRequiredChoice(ask, `Which control?\n${itemLines}\n> `, group.items.length);
  const targetRef = group.items[targetIndex].ref;

  return { mode: "existing-group", groupId: group.id, position: positionChoice === 1 ? { before: targetRef } : { after: targetRef } };
}
