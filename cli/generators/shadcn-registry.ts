// Trim CLI — `trim add`'s shadcn ref registry and installation. Same
// architecture as ./template-registry.ts (CLI-owned source templates,
// copied into dist/cli/templates/**, host-owned once installed, no runtime
// registry) plus one extra step ./template-registry.ts doesn't need: a
// small, deterministic substitution of the host's OWN configured shadcn
// import path into the template before writing it — never a template
// engine, never a guessed "@/components/ui" default.
//
// `@shadcn/...` refs are explicit, exactly like `@default/...` (see
// cli/commands/add.ts) — trim.json's persisted `shadcn` preference is never
// consulted here; an explicit @shadcn/ ref installs if and only if THIS
// project's actual components.json + tsconfig say it can, regardless of
// what trim.json recorded at `trim init` time.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readTemplate } from "../templates-path";
import { readShadcnSetup, resolveAliasSpecifier, COMPONENTS_JSON_PATH } from "../project/shadcn-config";
import { applyTemplateFilePlan, type TemplateFilePlan } from "./template-registry";
import { UsageError } from "../dispatch";

export type ShadcnTemplateEntry = {
  ref: string;
  templatePath: string;
  targetPath: string;
  /** The one shadcn primitive this renderer needs, e.g. { displayName: "Switch", fileBaseName: "switch" } — displayName as shadcn's own docs/CLI name it, fileBaseName as its generated file is named (ui/<fileBaseName>.tsx). */
  requiredComponent: { displayName: string; fileBaseName: string };
  usageHint: string;
};

// Named trim/renderers/shadcn-<kind>.tsx, not trim/renderers/<kind>.tsx —
// deliberately distinct from @default/controls/*'s target paths, so a
// project can install both variants side by side without one overwriting
// the other (see this step's own spec: "do not overwrite an existing
// default renderer just because the user later adds the shadcn variant").
export const SHADCN_TEMPLATE_REGISTRY: readonly ShadcnTemplateEntry[] = [
  {
    ref: "@shadcn/controls/boolean",
    templatePath: "shadcn/controls/boolean.tsx",
    targetPath: "trim/renderers/shadcn-boolean.tsx",
    requiredComponent: { displayName: "Switch", fileBaseName: "switch" },
    usageHint:
      'import { ShadcnBooleanControl } from "./renderers/shadcn-boolean";\n\n' +
      '// in a group\'s controls array:\n' +
      '{ id: "<your-control-id>", component: ShadcnBooleanControl },',
  },
  {
    ref: "@shadcn/controls/segmented",
    templatePath: "shadcn/controls/segmented.tsx",
    targetPath: "trim/renderers/shadcn-segmented.tsx",
    requiredComponent: { displayName: "ToggleGroup", fileBaseName: "toggle-group" },
    usageHint:
      'import { ShadcnSegmentedControl } from "./renderers/shadcn-segmented";\n\n' +
      '// in a group\'s controls array:\n' +
      '{ id: "<your-control-id>", component: ShadcnSegmentedControl },',
  },
  {
    ref: "@shadcn/controls/toggle-action",
    templatePath: "shadcn/controls/toggle-action.tsx",
    targetPath: "trim/renderers/shadcn-toggle-action.tsx",
    requiredComponent: { displayName: "Toggle", fileBaseName: "toggle" },
    usageHint:
      'import { ShadcnToggleActionControl } from "./renderers/shadcn-toggle-action";\n\n' +
      '// in a group\'s controls array:\n' +
      '{ id: "<your-control-id>", component: ShadcnToggleActionControl },',
  },
];

export function findShadcnTemplateEntry(ref: string): ShadcnTemplateEntry | undefined {
  return SHADCN_TEMPLATE_REGISTRY.find((entry) => entry.ref === ref);
}

export function listShadcnRefs(): readonly string[] {
  return SHADCN_TEMPLATE_REGISTRY.map((entry) => entry.ref);
}

const IMPORT_PLACEHOLDER = "__TRIM_SHADCN_UI_IMPORT__";

async function fileExistsWithAnyExtension(cwd: string, relativePathNoExt: string): Promise<boolean> {
  return [".tsx", ".ts", ".jsx", ".js"].some((ext) => existsSync(path.join(cwd, `${relativePathNoExt}${ext}`)));
}

/**
 * Reads only — never writes. Throws UsageError for any reason nothing
 * should be written: no shadcn setup, no usable "ui" alias, an alias this
 * project's own tsconfig `paths` can't resolve, or the required component
 * genuinely missing on disk. Never shells out to the shadcn CLI, never
 * installs a missing component itself — see this step's own spec for why
 * (a generated import must point at something that already compiles).
 */
export async function buildShadcnTemplatePlan(cwd: string, entry: ShadcnTemplateEntry): Promise<TemplateFilePlan> {
  const setup = readShadcnSetup(cwd);
  if (!setup) {
    throw new UsageError(
      `${entry.ref} requires a shadcn setup in this project (no ${COMPONENTS_JSON_PATH} found). ` +
        `Set it up first (https://ui.shadcn.com/docs/installation), then re-run \`trim add ${entry.ref}\`.`,
    );
  }

  const uiAlias = setup.aliases.ui;
  if (!uiAlias) {
    throw new UsageError(`${COMPONENTS_JSON_PATH} has no "ui" alias configured — trim add ${entry.ref} cannot determine where your shadcn components live.`);
  }

  const componentSpecifier = `${uiAlias}/${entry.requiredComponent.fileBaseName}`;
  const resolvedRelPath = resolveAliasSpecifier(cwd, componentSpecifier);
  if (!resolvedRelPath) {
    throw new UsageError(
      `could not resolve the shadcn "ui" alias ("${uiAlias}") to a real path via this project's tsconfig \`paths\` — trim add never guesses at an alias. ` +
        `Configure a matching wildcard path alias in tsconfig.json (e.g. "${uiAlias.replace(/\/[^/]*$/, "")}/*"), then re-run \`trim add ${entry.ref}\`.`,
    );
  }

  const componentExists = await fileExistsWithAnyExtension(cwd, resolvedRelPath);
  if (!componentExists) {
    throw new UsageError(
      `${entry.ref} requires the shadcn ${entry.requiredComponent.displayName} component.\n\n` +
        `Add it first with your shadcn CLI, then re-run:\n  trim add ${entry.ref}`,
    );
  }

  const contents = readTemplate(entry.templatePath).split(IMPORT_PLACEHOLDER).join(uiAlias);
  const fullPath = path.join(cwd, entry.targetPath);
  if (!existsSync(fullPath)) {
    return { path: entry.targetPath, contents, status: "create" };
  }
  const existing = await readFile(fullPath, "utf8");
  return { path: entry.targetPath, contents, status: existing === contents ? "matches" : "conflict" };
}

export { applyTemplateFilePlan as applyShadcnTemplatePlan };
