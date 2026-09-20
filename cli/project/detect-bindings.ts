// Trim CLI — `trim detect`'s static analysis core: scans a host TypeScript
// Program (see ./ts-program.ts) for top-level variable declarations that
// are STRUCTURALLY shaped like a TrimBinding<T> — `{ get(): T; set(value:
// T): void; subscribe(listener: (value: T) => void): () => void }` — using
// the real type checker, never a text/regex scan and never a nominal
// import-identity check against `@theharborproject/trim`'s own types (a
// host file may not even have that package installed, and TrimBinding is a
// duck-typed contract by design — see src/core/bindings.ts). This is
// exactly how `export const x = callback(...)` and `export const x =
// controller(...)` end up detected: through the shape of what they return,
// not by recognizing the call expression syntax.
//
// CRITICAL RULE (this step's own spec): if Trim is not sure, it must not
// invent a binding. Every classification here is conservative — anything
// that doesn't structurally match ALL THREE members with the right
// signatures, or whose value type isn't one of the currently supported
// safe kinds, is reported as a lesser category (or not reported at all),
// never guessed into something more specific.

import path from "node:path";
import type ts from "typescript";
import type { HostProgram } from "./ts-program";
import { suggestControlId } from "./control-id";

const EXCLUDED_TOP_SEGMENTS = new Set(["node_modules", "dist", "build", ".next", "out", "coverage", "trim"]);

/** Never scans node_modules, common build-output directories, or trim/** itself — see this step's own spec, section 4 ("never rediscover Trim's own generated declarations as new candidates"). */
function isScannableFile(cwd: string, absPath: string): boolean {
  const rel = path.relative(cwd, absPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false; // outside the project root entirely
  const firstSegment = rel.split(path.sep)[0];
  return !EXCLUDED_TOP_SEGMENTS.has(firstSegment);
}

function toProjectRelativePosixPath(cwd: string, absPath: string): string {
  return path.relative(cwd, absPath).split(path.sep).join("/");
}

/**
 * "contrastBinding" -> "contrast", "reducedMotionBinding" -> "reduced-motion",
 * "myToggle" -> "my-toggle". A PROPOSAL only — every caller must still show
 * it for confirmation and validate it with isValidControlId before ever
 * using it (see cli/project/control-id.ts's own doc on suggestControlId,
 * which this composes with for final sanitization).
 */
export function symbolNameToControlId(symbolName: string): string {
  const withoutBindingSuffix = symbolName.replace(/Binding$/, "");
  const base = withoutBindingSuffix.length > 0 ? withoutBindingSuffix : symbolName;
  const kebab = base
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  return suggestControlId(kebab);
}

function getSingleCallSignature(type: ts.Type): ts.Signature | undefined {
  const signatures = type.getCallSignatures();
  return signatures.length === 1 ? signatures[0] : undefined;
}

/**
 * Returns the binding's value type (get()'s return type) only when `type`
 * structurally has all three TrimBinding members with compatible
 * signatures: a zero-argument `get`, a one-argument `set`, and a
 * one-argument `subscribe` whose argument is itself a one-argument
 * function and whose own return value is callable (the unsubscribe
 * function). Anything short of this — missing a member, wrong arity, a
 * `subscribe` that doesn't return a function — returns `undefined`: this
 * is deliberately narrow so an unrelated object that merely HAPPENS to
 * have methods named get/set (with no subscribe, or an incompatible one)
 * is never mistaken for a real binding.
 */
function getTrimBindingValueType(checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined {
  const getSym = type.getProperty("get");
  const setSym = type.getProperty("set");
  const subscribeSym = type.getProperty("subscribe");
  if (!getSym?.valueDeclaration || !setSym?.valueDeclaration || !subscribeSym?.valueDeclaration) return undefined;

  const getSig = getSingleCallSignature(checker.getTypeOfSymbolAtLocation(getSym, getSym.valueDeclaration));
  if (!getSig || getSig.parameters.length !== 0) return undefined;
  const valueType = checker.getReturnTypeOfSignature(getSig);

  const setSig = getSingleCallSignature(checker.getTypeOfSymbolAtLocation(setSym, setSym.valueDeclaration));
  if (!setSig || setSig.parameters.length !== 1) return undefined;

  const subscribeSig = getSingleCallSignature(checker.getTypeOfSymbolAtLocation(subscribeSym, subscribeSym.valueDeclaration));
  if (!subscribeSig || subscribeSig.parameters.length !== 1) return undefined;

  const listenerParam = subscribeSig.parameters[0];
  if (!listenerParam.valueDeclaration) return undefined;
  const listenerType = checker.getTypeOfSymbolAtLocation(listenerParam, listenerParam.valueDeclaration);
  const listenerSig = getSingleCallSignature(listenerType);
  if (!listenerSig || listenerSig.parameters.length !== 1) return undefined;

  const subscribeReturnType = checker.getReturnTypeOfSignature(subscribeSig);
  if (subscribeReturnType.getCallSignatures().length === 0) return undefined; // must return an unsubscribe function

  return valueType;
}

export type ClassifiedValueType = { kind: "boolean" } | { kind: "segmented"; options: readonly string[] };

/**
 * Only two safe mappings in v1, exactly as scoped: the widened `boolean`
 * type, or a finite union of 2+ string LITERAL types (never a bare
 * `string`, never a union that includes anything else — `undefined`,
 * `null`, a non-literal member — which fails the "every member is a
 * string literal" check below and is correctly left unclassified).
 * `TypeFlags.Boolean` is TypeScript's own flag for the widened `boolean`
 * union (exactly `true | false`), distinct from a single boolean literal
 * type — this is the standard compiler-API technique for "is this the
 * general boolean type", not a heuristic of this module's own invention.
 */
function classifyValueType(tsc: typeof ts, type: ts.Type): ClassifiedValueType | undefined {
  if ((type.flags & tsc.TypeFlags.Boolean) !== 0) return { kind: "boolean" };
  if (type.isUnion()) {
    const members = type.types;
    if (members.length >= 2 && members.every((member) => member.isStringLiteral())) {
      return { kind: "segmented", options: members.map((member) => (member as ts.StringLiteralType).value) };
    }
  }
  return undefined;
}

export type DetectedCandidate =
  | { status: "ready"; symbolName: string; filePath: string; importPath: string; proposedId: string; kind: "boolean" }
  | { status: "ready"; symbolName: string; filePath: string; importPath: string; proposedId: string; kind: "segmented"; options: readonly string[] }
  | { status: "unsupported-type"; symbolName: string; filePath: string }
  | { status: "not-exported"; symbolName: string; filePath: string };

export type ScanResult = {
  /** In-project, non-declaration files actually examined — excludes node_modules, .d.ts files, the trim/ directory, and common build-output dirs. Reported per this step's own spec (section 26). */
  filesExamined: number;
  candidates: readonly DetectedCandidate[];
};

/**
 * One pass over the host's own project files (never node_modules, never
 * trim/**, never a build-output directory), inspecting every TOP-LEVEL
 * variable declaration's type. Read-only: builds a plain description of
 * what was found, never touches the filesystem itself. Deliberately does
 * NOT walk into function/class bodies or block-scoped locals — every
 * example in this step's spec is a module-level `export const`, and
 * limiting the scan to module scope keeps it both fast and low-noise (a
 * binding buried inside a function isn't importable from a *.trim.ts file
 * regardless, so there factory would be nothing safe to propose from it).
 */
export function scanForBindingCandidates(host: HostProgram, cwd: string): ScanResult {
  const { tsc, program, checker, rootFileNames } = host;
  const candidates: DetectedCandidate[] = [];
  let filesExamined = 0;

  for (const absPath of rootFileNames) {
    if (!isScannableFile(cwd, absPath)) continue;
    const sourceFile = program.getSourceFile(absPath);
    if (!sourceFile || sourceFile.isDeclarationFile) continue;
    filesExamined++;

    const filePath = toProjectRelativePosixPath(cwd, absPath);
    const importPath = filePath.replace(/\.tsx?$/, "");

    for (const statement of sourceFile.statements) {
      if (!tsc.isVariableStatement(statement)) continue;
      const isExported = statement.modifiers?.some((m) => m.kind === tsc.SyntaxKind.ExportKeyword) ?? false;

      for (const declaration of statement.declarationList.declarations) {
        if (!tsc.isIdentifier(declaration.name)) continue; // never a destructuring pattern — no single symbol to propose as an id
        const symbolName = declaration.name.text;
        const type = checker.getTypeAtLocation(declaration.name);
        const valueType = getTrimBindingValueType(checker, type);
        if (!valueType) continue; // not TrimBinding-shaped at all — not a candidate of any kind

        if (!isExported) {
          candidates.push({ status: "not-exported", symbolName, filePath });
          continue;
        }

        const classified = classifyValueType(tsc, valueType);
        if (!classified) {
          candidates.push({ status: "unsupported-type", symbolName, filePath });
          continue;
        }

        candidates.push(
          classified.kind === "boolean"
            ? { status: "ready", symbolName, filePath, importPath, proposedId: symbolNameToControlId(symbolName), kind: "boolean" }
            : { status: "ready", symbolName, filePath, importPath, proposedId: symbolNameToControlId(symbolName), kind: "segmented", options: classified.options },
        );
      }
    }
  }

  return { filesExamined, candidates };
}
