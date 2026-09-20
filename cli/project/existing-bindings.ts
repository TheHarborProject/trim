// Trim CLI — determines which (source file, exported symbol) pairs an
// EXISTING trim/controls/*.trim.ts declaration already binds to, so `trim
// detect` never proposes a second control for a binding a project has
// already integrated under a different id (this step's own spec, section
// 14). Structural (AST-based) via the same bundled TypeScript compiler
// control-uniqueness.ts already uses — never fragile source-text
// comparison, per that section's own instruction.
//
// Only recognizes the "Existing TrimBinding" shape (`binding:
// someIdentifier`, imported from somewhere) — the exact shape both `trim
// new control`'s "Existing TrimBinding" flow and `trim detect`'s own
// generation (see ./detect-plan.ts) produce. A Trim-managed binding
// (`trimSettings.<key>`) or a callback(...)/controller(...) call expression
// written directly in the control file isn't a plain re-export of a single
// host symbol the way an "existing" binding is, so there's no comparable
// (file, symbol) pair to extract from it without a much deeper (and
// fragile) equivalence check this step deliberately avoids.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type ts from "@typescript/typescript6";
import type { TS } from "./resolve-typescript";
import { findDefineControlObjectLiteral } from "./control-uniqueness";
import { resolveImportTarget } from "./binding-validation";

function findBindingIdentifier(tsc: TS, objectLiteral: ts.ObjectLiteralExpression): string | undefined {
  const prop = objectLiteral.properties.find((p): p is ts.PropertyAssignment => tsc.isPropertyAssignment(p) && tsc.isIdentifier(p.name) && p.name.text === "binding");
  return prop && tsc.isIdentifier(prop.initializer) ? prop.initializer.text : undefined;
}

/** The relative module specifier an import statement in `sourceFile` bound `identifierName` to (default or named import), or undefined if no import binds that name. */
function findImportModuleSpecifier(tsc: TS, sourceFile: ts.SourceFile, identifierName: string): string | undefined {
  for (const statement of sourceFile.statements) {
    if (!tsc.isImportDeclaration(statement) || !statement.importClause || !tsc.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const { importClause, moduleSpecifier } = statement;
    if (importClause.name?.text === identifierName) return moduleSpecifier.text;
    if (importClause.namedBindings && tsc.isNamedImports(importClause.namedBindings)) {
      if (importClause.namedBindings.elements.some((el) => el.name.text === identifierName)) return moduleSpecifier.text;
    }
  }
  return undefined;
}

/** "<absolute source file path>::<exported symbol name>" — a stable key both this module and detect-plan.ts's candidate lookup can compute independently and compare by equality. */
export function bindingSourceKey(absoluteFilePath: string, symbolName: string): string {
  return `${absoluteFilePath}::${symbolName}`;
}

/**
 * Reads each `trim/controls/<id>.trim.ts` for `controlIds`, and returns the
 * set of `bindingSourceKey(...)` values for every one whose `binding:` is a
 * plain identifier imported from somewhere resolvable on disk. An
 * unparseable file, a binding that isn't a plain identifier, or an import
 * this module can't resolve to a real file is simply left out of the set —
 * never treated as an error (a false negative here just means `trim
 * detect` might propose a harmless duplicate the user can decline, which
 * this step's own "a false negative is acceptable" rule explicitly allows).
 */
export async function collectExistingBindingSources(tsc: TS, cwd: string, controlsDir: string, controlIds: readonly string[]): Promise<ReadonlySet<string>> {
  const keys = new Set<string>();

  for (const id of controlIds) {
    const controlFilePath = path.join(cwd, controlsDir, `${id}.trim.ts`);
    let source: string;
    try {
      source = await readFile(controlFilePath, "utf8");
    } catch {
      continue;
    }

    let sourceFile: ts.SourceFile;
    try {
      sourceFile = tsc.createSourceFile(controlFilePath, source, tsc.ScriptTarget.Latest, true, tsc.ScriptKind.TS);
    } catch {
      continue;
    }

    const objectLiteral = findDefineControlObjectLiteral(tsc, sourceFile);
    if (!objectLiteral) continue;
    const identifierName = findBindingIdentifier(tsc, objectLiteral);
    if (!identifierName) continue;
    const moduleSpecifier = findImportModuleSpecifier(tsc, sourceFile, identifierName);
    if (!moduleSpecifier) continue;

    const resolved = resolveImportTarget(path.dirname(controlFilePath), moduleSpecifier);
    if (!resolved) continue;

    keys.add(bindingSourceKey(resolved, identifierName));
  }

  return keys;
}
