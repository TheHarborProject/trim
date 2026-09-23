// Trim CLI — `trim add`'s STATIC ref registry and single-file template
// installation. No remote registry, no network lookup, no template engine:
// every ref here maps to one file already bundled inside this package (see
// ../templates-path.ts), copied byte-for-byte into the host project, which
// owns it from that point on. An unknown ref is a UsageError listing what
// IS supported — never a network fetch, never a guess.
//
// "@default/example" is NOT in this registry — it installs several files,
// three of which are generated live by the same generators `trim new
// control`/`trim attach` use (never templated at all, so they can never
// drift from what those commands actually produce) — see
// ./example-plan.ts.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readTemplate } from "../templates-path";
import { UsageError } from "../dispatch";

export type TemplateFileStatus = "create" | "matches" | "conflict";

export type TemplateEntry = {
  ref: string;
  /** Path under templates-path.ts's TEMPLATES_ROOT. */
  templatePath: string;
  /** Project-relative path this installs to. */
  targetPath: string;
  /** Printed after a successful install — how to wire the installed file into trim.config.tsx. Never applied automatically (see item 17 in this step's spec: no automatic config edit). */
  usageHint: string;
};

export const TEMPLATE_REGISTRY: readonly TemplateEntry[] = [
  {
    ref: "@default/controls/boolean",
    templatePath: "default/controls/boolean.tsx",
    targetPath: "trim/renderers/boolean.tsx",
    usageHint:
      'import { BooleanControl } from "./renderers/boolean";\n\n' +
      '// in a group\'s controls array:\n' +
      '{ id: "<your-control-id>", component: BooleanControl },',
  },
  {
    ref: "@default/controls/segmented",
    templatePath: "default/controls/segmented.tsx",
    targetPath: "trim/renderers/segmented.tsx",
    usageHint:
      'import { SegmentedControl } from "./renderers/segmented";\n\n' +
      '// in a group\'s controls array:\n' +
      '{ id: "<your-control-id>", component: SegmentedControl },',
  },
  {
    ref: "@default/controls/toggle-action",
    templatePath: "default/controls/toggle-action.tsx",
    targetPath: "trim/renderers/toggle-action.tsx",
    usageHint:
      'import { ToggleActionControl } from "./renderers/toggle-action";\n\n' +
      '// in a group\'s controls array:\n' +
      '{ id: "<your-control-id>", component: ToggleActionControl },',
  },
  {
    ref: "@default/layouts/sections",
    templatePath: "default/layouts/sections.tsx",
    targetPath: "trim/layouts/sections.tsx",
    usageHint:
      'import { SectionsLayout } from "./layouts/sections";\n\n' +
      "// in trim.config.tsx's defineTrimConfig({ ... }):\n" +
      "layout: SectionsLayout,",
  },
];

export function findTemplateEntry(ref: string): TemplateEntry | undefined {
  return TEMPLATE_REGISTRY.find((entry) => entry.ref === ref);
}

export function listKnownRefs(): readonly string[] {
  return [...TEMPLATE_REGISTRY.map((entry) => entry.ref), "@default/example"];
}

export type TemplateFilePlan<T extends string | Uint8Array = string> = {
  path: string;
  contents: T;
  status: TemplateFileStatus;
};

/** Reads only — never writes. The one status a caller must treat as "print the plan and stop": "conflict". */
export async function buildTemplateFilePlan(cwd: string, entry: TemplateEntry): Promise<TemplateFilePlan> {
  const contents = readTemplate(entry.templatePath);
  const fullPath = path.join(cwd, entry.targetPath);
  if (!existsSync(fullPath)) {
    return { path: entry.targetPath, contents, status: "create" };
  }
  const existing = await readFile(fullPath, "utf8");
  return { path: entry.targetPath, contents, status: existing === contents ? "matches" : "conflict" };
}

/** Only ever called with a "create" (or already-"matches", a harmless no-op rewrite) plan — never "conflict"; see cli/commands/add.ts. */
export async function applyTemplateFilePlan(cwd: string, plan: TemplateFilePlan<string | Uint8Array>): Promise<void> {
  if (plan.status === "conflict") {
    throw new UsageError(`refusing to overwrite ${plan.path} — this should not be reached; trim add never applies a conflicting plan.`);
  }
  const fullPath = path.join(cwd, plan.path);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, plan.contents, "utf8");
}
