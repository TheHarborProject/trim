// Trim CLI — resolves a declared control's `is_unique` from its real
// trim/controls/<id>.trim.ts declaration, via the same host TypeScript
// compiler trim-config-ast.ts uses. Structural (AST-based), not a text
// scan: a control file is "host-owned" (a human may reformat it freely
// after generation), so its exact whitespace/formatting cannot be trusted
// the way trim.settings.ts's machine-only shape can.

import { readFile } from "node:fs/promises";
import type ts from "typescript";
import type { TS } from "./resolve-typescript";

/** Exported for ./existing-bindings.ts, which walks the same defineXControl({...}) shape to find an existing control's `binding:` expression. */
export function findDefineControlObjectLiteral(tsc: TS, sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  let result: ts.ObjectLiteralExpression | undefined;
  sourceFile.forEachChild((node) => {
    if (result) return;
    if (tsc.isExportAssignment(node) && !node.isExportEquals) {
      const expr = node.expression;
      if (tsc.isCallExpression(expr) && tsc.isIdentifier(expr.expression) && /^define\w*Control$/.test(expr.expression.text)) {
        const [arg] = expr.arguments;
        if (arg && tsc.isObjectLiteralExpression(arg)) result = arg;
      }
    }
  });
  return result;
}

/**
 * `undefined` (omitted) and `true` both mean unique; only a literal
 * `false` means the control may be attached more than once — see
 * core/integration.ts's own TrimControlBase comment for why this is the
 * interpretation everywhere in the package, not just here. A declaration
 * this module cannot structurally parse is treated as unique — the safer
 * default, since it can never produce a false "may repeat".
 */
export async function resolveControlIsUnique(tsc: TS, controlFilePath: string): Promise<boolean> {
  let source: string;
  try {
    source = await readFile(controlFilePath, "utf8");
  } catch {
    return true;
  }
  const sourceFile = tsc.createSourceFile(controlFilePath, source, tsc.ScriptTarget.Latest, true, tsc.ScriptKind.TS);
  const objectLiteral = findDefineControlObjectLiteral(tsc, sourceFile);
  if (!objectLiteral) return true;

  const prop = objectLiteral.properties.find((p): p is ts.PropertyAssignment => tsc.isPropertyAssignment(p) && tsc.isIdentifier(p.name) && p.name.text === "is_unique");
  if (!prop) return true;
  return prop.initializer.kind !== tsc.SyntaxKind.FalseKeyword;
}
