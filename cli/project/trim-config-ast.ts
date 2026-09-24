// Trim CLI — structural (AST-based) reading and minimal-splice editing of
// trim/trim.config.tsx, using Trim's own bundled TypeScript compiler
// (see ./resolve-typescript.ts). Never reprints or reformats the whole
// file: every write this module produces is the original source text with
// one small, precisely-located insertion spliced in — imports, comments,
// unrelated expressions, and any part of the file `trim attach` doesn't
// touch are passed through completely unchanged, byte for byte.
//
// Deliberately conservative: anything about the file's shape this module
// cannot fully account for (a dynamic `groups` expression, an
// unrecognized `controls` array entry, a group missing a literal id) is
// reported as UnsupportedConfigShapeError rather than guessed at — a wrong
// guess here could silently corrupt a host-owned file or, worse, miss an
// existing attachment during a uniqueness check.

import type ts from "@typescript/typescript6";
import type { TS } from "./resolve-typescript";

export class UnsupportedConfigShapeError extends Error {}

export type ExistingItem = {
  /** The control id this item resolves to — from a bare string ("theme") or an object literal's `id` field ({ id: "contrast", component: X }). */
  ref: string;
};

/** `node`/`controlsArray` are the real AST nodes splices are computed against — read their own fields (id/label/items) for display, but treat the nodes themselves as this module's own implementation detail. */
export type ExistingGroup = {
  id: string;
  label: string | undefined;
  items: readonly ExistingItem[];
  node: ts.ObjectLiteralExpression;
  controlsArray: ts.ArrayLiteralExpression;
};

export type ParsedConfig = {
  sourceFile: ts.SourceFile;
  configObject: ts.ObjectLiteralExpression;
  groupsArray: ts.ArrayLiteralExpression;
  groups: readonly ExistingGroup[];
};

export type TrimConfigUiInfo = {
  adapter?: string;
  hasUi: boolean;
  hasRenderers: boolean;
  rendererLocal?: string;
  uiObject?: ts.ObjectLiteralExpression;
};

function findDefaultExportObjectLiteral(tsc: TS, sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  let result: ts.ObjectLiteralExpression | undefined;
  sourceFile.forEachChild((node) => {
    if (result) return;
    if (tsc.isExportAssignment(node) && !node.isExportEquals) {
      const expr = node.expression;
      if (tsc.isCallExpression(expr) && tsc.isIdentifier(expr.expression) && expr.expression.text === "defineTrimConfig") {
        const [arg] = expr.arguments;
        if (arg && tsc.isObjectLiteralExpression(arg)) result = arg;
      }
    }
  });
  return result;
}

function findStringLiteralProp(tsc: TS, obj: ts.ObjectLiteralExpression, name: string): string | undefined {
  const prop = obj.properties.find((p): p is ts.PropertyAssignment => tsc.isPropertyAssignment(p) && tsc.isIdentifier(p.name) && p.name.text === name);
  return prop && tsc.isStringLiteralLike(prop.initializer) ? prop.initializer.text : undefined;
}

function findArrayProp(tsc: TS, obj: ts.ObjectLiteralExpression, name: string): ts.ArrayLiteralExpression | undefined {
  const prop = obj.properties.find((p): p is ts.PropertyAssignment => tsc.isPropertyAssignment(p) && tsc.isIdentifier(p.name) && p.name.text === name);
  return prop && tsc.isArrayLiteralExpression(prop.initializer) ? prop.initializer : undefined;
}

function extractItems(tsc: TS, controlsArray: ts.ArrayLiteralExpression): ExistingItem[] {
  const items: ExistingItem[] = [];
  for (const element of controlsArray.elements) {
    if (tsc.isStringLiteralLike(element)) {
      items.push({ ref: element.text });
      continue;
    }
    if (tsc.isObjectLiteralExpression(element)) {
      const id = findStringLiteralProp(tsc, element, "id");
      if (id !== undefined) {
        items.push({ ref: id });
        continue;
      }
    }
    // A dynamic expression, a bare identifier, a spread, or an object with
    // no literal `id` — we cannot know what control (if any) this refers
    // to, so we cannot guarantee a uniqueness check is correct. Fail safe
    // rather than silently under-counting existing attachments.
    throw new UnsupportedConfigShapeError(
      "a `controls` array entry is neither a string literal nor a recognizable { id, component } object — trim attach cannot safely edit this config automatically.",
    );
  }
  return items;
}

function extractGroups(tsc: TS, groupsArray: ts.ArrayLiteralExpression): ExistingGroup[] {
  const groups: ExistingGroup[] = [];
  for (const element of groupsArray.elements) {
    if (!tsc.isObjectLiteralExpression(element)) {
      throw new UnsupportedConfigShapeError("a `groups` array entry is not a plain object literal — trim attach cannot safely edit this config automatically.");
    }
    const id = findStringLiteralProp(tsc, element, "id");
    const controlsArray = findArrayProp(tsc, element, "controls");
    if (id === undefined || !controlsArray) {
      throw new UnsupportedConfigShapeError("a `groups` entry is missing a literal `id` or a literal `controls` array — trim attach cannot safely edit this config automatically.");
    }
    groups.push({ id, label: findStringLiteralProp(tsc, element, "label"), node: element, controlsArray, items: extractItems(tsc, controlsArray) });
  }
  return groups;
}

/**
 * Locates the exact `groups: [...]` array literal inside
 * `export default defineTrimConfig({ ... })`. Throws UnsupportedConfigShapeError
 * for anything this module cannot fully account for — see this file's
 * header for why that is the safe default, not a fallback to guessing.
 */
export function parseTrimConfig(tsc: TS, sourceText: string, filePath: string): ParsedConfig {
  const sourceFile = tsc.createSourceFile(filePath, sourceText, tsc.ScriptTarget.Latest, true, tsc.ScriptKind.TSX);

  const configLiteral = findDefaultExportObjectLiteral(tsc, sourceFile);
  if (!configLiteral) {
    throw new UnsupportedConfigShapeError("could not find `export default defineTrimConfig({ ... })` with a plain object literal argument.");
  }

  const groupsArray = findArrayProp(tsc, configLiteral, "groups");
  if (!groupsArray) {
    throw new UnsupportedConfigShapeError("the `groups` property is not a plain array literal — it may be a variable reference, a function call, or missing entirely.");
  }

  return { sourceFile, configObject: configLiteral, groupsArray, groups: extractGroups(tsc, groupsArray) };
}

export function inspectTrimConfigUi(tsc: TS, parsed: ParsedConfig): TrimConfigUiInfo {
  const uiProperty = parsed.configObject.properties.find((p): p is ts.PropertyAssignment =>
    tsc.isPropertyAssignment(p) && tsc.isIdentifier(p.name) && p.name.text === "ui",
  );
  if (!uiProperty) return { hasUi: false, hasRenderers: false };
  if (!tsc.isObjectLiteralExpression(uiProperty.initializer)) {
    throw new UnsupportedConfigShapeError("the `ui` property is not a plain object literal — Trim cannot safely configure its adapter or renderer map.");
  }
  const uiObject = uiProperty.initializer;
  const adapter = findStringLiteralProp(tsc, uiObject, "adapter");
  const renderers = uiObject.properties.find((p): p is ts.PropertyAssignment => tsc.isPropertyAssignment(p) && tsc.isIdentifier(p.name) && p.name.text === "renderers");
  return { adapter, hasUi: true, hasRenderers: renderers !== undefined, rendererLocal: renderers && tsc.isIdentifier(renderers.initializer) ? renderers.initializer.text : undefined, uiObject };
}

export function computeTrimUiEdit(
  tsc: TS,
  parsed: ParsedConfig,
  sourceText: string,
  changes: { adapter?: string; rendererLocal?: string },
): string {
  const info = inspectTrimConfigUi(tsc, parsed);
  if (!info.hasUi) {
    const indent = lineIndentAt(parsed.sourceFile, parsed.configObject.getStart(parsed.sourceFile));
    const rendererLine = changes.rendererLocal ? `${indent}    renderers: ${changes.rendererLocal},\n` : "";
    const uiText = `\n${indent}  ui: {\n${indent}    adapter: ${JSON.stringify(changes.adapter)},\n${rendererLine}${indent}  },`;
    return sourceText.slice(0, parsed.configObject.getStart(parsed.sourceFile) + 1) + uiText + sourceText.slice(parsed.configObject.getStart(parsed.sourceFile) + 1);
  }
  const uiObject = info.uiObject!;
  const uiIndent = lineIndentAt(parsed.sourceFile, uiObject.getStart(parsed.sourceFile));
  const innerIndent = `${uiIndent}  `;
  const additions: string[] = [];
  if (changes.adapter !== undefined && info.adapter === undefined) additions.push(`adapter: ${JSON.stringify(changes.adapter)}`);
  if (changes.rendererLocal && !info.hasRenderers) additions.push(`renderers: ${changes.rendererLocal}`);
  if (additions.length === 0) return sourceText;
  const close = uiObject.getEnd() - 1;
  const properties = uiObject.properties;
  if (properties.length === 0) return sourceText.slice(0, close) + `\n${additions.map((x) => `${innerIndent}${x},`).join("\n")}\n${uiIndent}` + sourceText.slice(close);
  const last = properties[properties.length - 1];
  const between = sourceText.slice(last.getEnd(), close);
  const comma = between.includes(",") ? "" : ",";
  return sourceText.slice(0, close) + `${comma}\n${additions.map((x) => `${innerIndent}${x},`).join("\n")}\n${uiIndent}` + sourceText.slice(close);
}

function lineIndentAt(sourceFile: ts.SourceFile, pos: number): string {
  const { line } = sourceFile.getLineAndCharacterOfPosition(pos);
  const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
  const match = /^[ \t]*/.exec(sourceFile.text.slice(lineStart, pos));
  return match ? match[0] : "";
}

/**
 * Computes ONE text insertion — {position, text} — into `array`, never a
 * full reprint. `relative` (optional) positions before/after an existing
 * element by index; omitting it appends. Reuses the array's own recorded
 * `hasTrailingComma` (a real TypeScript AST fact, not inferred by
 * scanning) so the existing comma style is preserved exactly, and infers
 * indentation from the array's own line rather than reformatting anything
 * else in the file.
 */
function computeArrayInsertion(
  sourceFile: ts.SourceFile,
  array: ts.ArrayLiteralExpression,
  itemText: string,
  relative?: { before: number } | { after: number },
): { position: number; text: string } {
  const elements = array.elements;
  const propIndent = lineIndentAt(sourceFile, array.getStart(sourceFile));
  const itemIndent = `${propIndent}  `;

  if (elements.length === 0) {
    return { position: array.getStart(sourceFile) + 1, text: `\n${itemIndent}${itemText},\n${propIndent}` };
  }

  if (relative && "before" in relative) {
    const target = elements[relative.before];
    return { position: target.getStart(sourceFile), text: `${itemText},\n${itemIndent}` };
  }

  const insertAfterIndex = relative && "after" in relative ? relative.after : elements.length - 1;
  const target = elements[insertAfterIndex];
  const isLast = insertAfterIndex === elements.length - 1;

  if (isLast && elements.hasTrailingComma) {
    const commaPos = sourceFile.text.indexOf(",", target.getEnd());
    return { position: commaPos + 1, text: `\n${itemIndent}${itemText},` };
  }
  return { position: target.getEnd(), text: `,\n${itemIndent}${itemText}` };
}

function applyInsertion(sourceText: string, insertion: { position: number; text: string }): string {
  return sourceText.slice(0, insertion.position) + insertion.text + sourceText.slice(insertion.position);
}

export type AttachTarget =
  | { kind: "existing-group"; group: ExistingGroup; position: "append" | { before: string } | { after: string } }
  | { kind: "new-group"; groupId: string; groupLabel: string };

/**
 * Produces the FULL new file text (original text plus exactly one
 * insertion) — never a reprint of the whole AST. `ref` is the bare control
 * id or dotted ref to attach (attach never generates a component
 * override — see cli/commands/attach.ts's header).
 */
export function computeAttachEdit(parsed: ParsedConfig, ref: string, target: AttachTarget, sourceText: string, explicitItemText?: string): string {
  const itemText = explicitItemText ?? JSON.stringify(ref);

  if (target.kind === "new-group") {
    // Must match computeArrayInsertion's OWN itemIndent exactly (below):
    // that is where it will place this text's opening "{", one level
    // deeper than the groups array's own line — not the array's own
    // indent directly, which would misalign the group's closing "}" (and
    // every inner line) with where its "{" actually ends up.
    const arrayIndent = lineIndentAt(parsed.sourceFile, parsed.groupsArray.getStart(parsed.sourceFile));
    const itemIndent = `${arrayIndent}  `;
    const innerIndent = `${itemIndent}  `;
    const groupText =
      `{\n` +
      `${innerIndent}id: ${JSON.stringify(target.groupId)},\n` +
      `${innerIndent}label: ${JSON.stringify(target.groupLabel)},\n` +
      `${innerIndent}controls: [\n` +
      `${innerIndent}  ${itemText},\n` +
      `${innerIndent}],\n` +
      `${itemIndent}}`;
    const insertion = computeArrayInsertion(parsed.sourceFile, parsed.groupsArray, groupText);
    return applyInsertion(sourceText, insertion);
  }

  const { group, position } = target;
  let relative: { before: number } | { after: number } | undefined;
  if (typeof position === "object") {
    const isBefore = "before" in position;
    const targetRef = isBefore ? position.before : position.after;
    const index = group.items.findIndex((item) => item.ref === targetRef);
    if (index === -1) {
      throw new UnsupportedConfigShapeError(`could not find "${targetRef}" in group "${group.id}" to position ${isBefore ? "before" : "after"} it.`);
    }
    relative = isBefore ? { before: index } : { after: index };
  }
  const insertion = computeArrayInsertion(parsed.sourceFile, group.controlsArray, itemText, relative);
  return applyInsertion(sourceText, insertion);
}

/** A group to add via computeReplaceGroupsEdit — the same shape an existing group's `id`/`label`/`controls` fields carry, but as plain data (no AST node) since it doesn't exist in the source yet. */
export type GroupSpec = { id: string; label: string; controlIds: readonly string[] };

function buildGroupObjectText(itemIndent: string, innerIndent: string, group: GroupSpec): string {
  const controlLines = group.controlIds.map((id) => `${innerIndent}  ${JSON.stringify(id)},`).join("\n");
  return `${itemIndent}{\n${innerIndent}id: ${JSON.stringify(group.id)},\n${innerIndent}label: ${JSON.stringify(group.label)},\n${innerIndent}controls: [\n${controlLines}\n${innerIndent}],\n${itemIndent}},`;
}

/**
 * Produces the FULL new file text — original source with exactly one
 * splice, computed entirely in memory before any write — replacing every
 * group named in `removeGroupIds` with `addGroups`. Unlike
 * computeAttachEdit's incremental single-item insertion, this reconstructs
 * the whole `groups: [...]` interior in one pass, which is what lets a
 * caller remove-then-add without ever writing an intermediate state to
 * disk (see cli/generators/example-plan.ts's canonical-starter replacement
 * path, the only caller today).
 *
 * Deliberately narrow: refuses (UnsupportedConfigShapeError) unless
 * `removeGroupIds` names EVERY group currently in the array — this is not
 * a general partial-removal primitive, only what the canonical-starter
 * replacement needs (a config whose groups array is known ahead of time,
 * by the caller's own canonical-shape check, to contain nothing but the
 * group(s) being removed). A caller needing partial removal would need a
 * different function, not a relaxation of this one's guard.
 */
export function computeReplaceGroupsEdit(parsed: ParsedConfig, sourceText: string, removeGroupIds: readonly string[], addGroups: readonly GroupSpec[]): string {
  for (const id of removeGroupIds) {
    if (!parsed.groups.some((g) => g.id === id)) {
      throw new UnsupportedConfigShapeError(`expected a "${id}" group in trim.config.tsx's \`groups\` array, but none was found.`);
    }
  }
  if (parsed.groups.some((g) => !removeGroupIds.includes(g.id))) {
    throw new UnsupportedConfigShapeError(
      "computeReplaceGroupsEdit only supports replacing a `groups` array made up entirely of the group(s) being removed — this is a Trim CLI bug, not a user-facing condition.",
    );
  }

  const arrayIndent = lineIndentAt(parsed.sourceFile, parsed.groupsArray.getStart(parsed.sourceFile));
  const itemIndent = `${arrayIndent}  `;
  const innerIndent = `${itemIndent}  `;

  const groupTexts = addGroups.map((group) => buildGroupObjectText(itemIndent, innerIndent, group));
  const newInner = `\n${groupTexts.join("\n")}\n${arrayIndent}`;

  const start = parsed.groupsArray.getStart(parsed.sourceFile) + 1; // right after "["
  const end = parsed.groupsArray.getEnd() - 1; // right before "]"
  return sourceText.slice(0, start) + newInner + sourceText.slice(end);
}
