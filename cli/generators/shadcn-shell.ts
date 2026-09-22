// Trim CLI — `trim init`'s shadcn adapter shell generation (ui.adapter:
// "shadcn" with a visible ui.shell: "popover" | "dialog"). Host-local,
// generated once at init time — unlike SHADCN_TEMPLATE_REGISTRY's entries
// (installed on demand, per control, via `trim add @shadcn/...`), the shell
// is chosen exactly once, at `trim init` time, so it's generated inline by
// cli/generators/init-files.ts's buildInitPlan rather than through a
// separate `trim add` ref.
//
// Reuses the EXACT same alias-resolution/missing-component-detection path
// ./shadcn-registry.ts already established (readShadcnSetup,
// resolveAliasSpecifier, fileExistsWithAnyExtension) — never a second,
// subtly-different guessing mechanism. The one real difference from a
// SHADCN_TEMPLATE_REGISTRY entry: a shell needs TWO shadcn primitives at
// once (Button, plus Popover or Dialog), so a missing-component failure
// names all of them together, not just the first one found.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readTemplate } from "../templates-path";
import { readShadcnSetup, resolveAliasSpecifier, COMPONENTS_JSON_PATH, type ShadcnBackend } from "../project/shadcn-config";
import { fileExistsWithAnyExtension } from "./shadcn-registry";
import { relativeImportSpecifier, relativePathBetween } from "../project/module-resolution";
import type { ModuleResolutionMode } from "../project/detect-project";
import type { TrimShellValue } from "../project/trim-metadata";
import type { TemplateFilePlan } from "./template-registry";
import { UsageError } from "../dispatch";

export const SHELL_PATH = "trim/TrimShell.tsx";
const CONFIG_PATH_NO_EXT = "trim/trim.config";

type RequiredComponent = { displayName: string; fileBaseName: string };

/** Only "popover" and "dialog" need a generated shell file at all — see init-files.ts's own item 5 comment for why "inline" (vanilla OR shadcn) never generates one. */
export type ShadcnVisibleShell = "popover" | "dialog";

/** The two backends this generator can actually produce correct composition syntax for — "aria" (recognized but unsupported) and `undefined` (genuinely undetectable) are refused before this is ever consulted. See buildShadcnShellPlan. */
type SupportedShellBackend = Extract<ShadcnBackend, "radix" | "base">;

/** Button + Popover/Dialog — identical regardless of backend; only the generated COMPOSITION syntax (asChild vs. render) differs, which lives entirely in the template text picked by TEMPLATE_PATHS below. */
const REQUIRED_COMPONENTS: Record<ShadcnVisibleShell, readonly RequiredComponent[]> = {
  popover: [
    { displayName: "Button", fileBaseName: "button" },
    { displayName: "Popover", fileBaseName: "popover" },
  ],
  dialog: [
    { displayName: "Button", fileBaseName: "button" },
    { displayName: "Dialog", fileBaseName: "dialog" },
  ],
};

/** Radix keeps the original filenames (pre-existing templates, unchanged); Base UI gets a "-base" suffixed sibling. Never emits `asChild` in a Base UI template, never a nested interactive element in either — see each template file's own contents. */
const TEMPLATE_PATHS: Record<ShadcnVisibleShell, Record<SupportedShellBackend, string>> = {
  popover: {
    radix: "shadcn/shell/popover.tsx",
    base: "shadcn/shell/popover-base.tsx",
  },
  dialog: {
    radix: "shadcn/shell/dialog.tsx",
    base: "shadcn/shell/dialog-base.tsx",
  },
};

const IMPORT_PLACEHOLDER = "__TRIM_SHADCN_UI_IMPORT__";
const CONFIG_IMPORT_PLACEHOLDER = "__TRIM_CONFIG_IMPORT__";

/**
 * Reads only — never writes. Throws UsageError for any reason nothing
 * should be written: no shadcn setup, no usable "ui" alias, an undetectable
 * or not-yet-supported (React Aria) backend, an alias this project's own
 * tsconfig `paths` can't resolve, or one/both required components genuinely
 * missing on disk — mirroring ./shadcn-registry.ts's buildShadcnTemplatePlan
 * exactly, just for two required components (Button + Popover/Dialog)
 * instead of one, plus the backend check neither that function nor any
 * @shadcn/controls/* renderer needs (none of them wrap a Button in a
 * Trigger, so they're composition-syntax-agnostic). Never shells out to the
 * shadcn CLI, never installs a missing component itself.
 */
export async function buildShadcnShellPlan(cwd: string, shell: ShadcnVisibleShell, moduleResolution: ModuleResolutionMode): Promise<TemplateFilePlan> {
  const requiredComponents = REQUIRED_COMPONENTS[shell];
  const context = `ui.adapter: "shadcn" with ui.shell: "${shell}"`;

  const setup = readShadcnSetup(cwd);
  if (!setup) {
    throw new UsageError(
      `${context} requires a shadcn setup in this project (no ${COMPONENTS_JSON_PATH} found). ` + `Set it up first (https://ui.shadcn.com/docs/installation), then re-run \`trim init\`.`,
    );
  }

  const uiAlias = setup.aliases.ui;
  if (!uiAlias) {
    throw new UsageError(`${COMPONENTS_JSON_PATH} has no "ui" alias configured — ${context} cannot determine where your shadcn components live.`);
  }

  // Backend must be known BEFORE anything else: it decides which
  // composition syntax (asChild vs. render) gets generated, and guessing
  // wrong produces broken host code (nested <button>, hydration failure) —
  // see ShadcnSetup.backend's own doc for the detection algorithm.
  if (setup.backend === "aria") {
    throw new UsageError(
      `Trim's shadcn shell generator doesn't yet support the React Aria backend — detected via ${COMPONENTS_JSON_PATH}'s "style": "aria-..." — ` +
        `please use a Radix or Base UI shadcn project, or choose a different adapter.`,
    );
  }
  if (setup.backend !== "radix" && setup.backend !== "base") {
    throw new UsageError(
      `${context} could not determine which shadcn primitive backend (Radix or Base UI) this project uses. ` +
        `Add a recognized "style" value to ${COMPONENTS_JSON_PATH} (e.g. "radix-<name>" or "base-<name>"), ` +
        `or make sure your installed Popover/Dialog/Button component imports from a recognized package ` +
        `("radix-ui"/"@radix-ui/react-*" or "@base-ui/react/*"), then re-run \`trim init\`.`,
    );
  }
  const backend = setup.backend;

  // The alias pattern match is independent of which component name is
  // appended (see resolveAliasSpecifier's own doc: it matches a wildcard
  // PATTERN, then appends the rest) — resolving it once, against the first
  // required component, is representative for all of them.
  const firstResolved = resolveAliasSpecifier(cwd, `${uiAlias}/${requiredComponents[0].fileBaseName}`);
  if (!firstResolved) {
    throw new UsageError(
      `could not resolve the shadcn "ui" alias ("${uiAlias}") to a real path via this project's tsconfig \`paths\` — trim init never guesses at an alias. ` +
        `Configure a matching wildcard path alias in tsconfig.json (e.g. "${uiAlias.replace(/\/[^/]*$/, "")}/*"), then re-run \`trim init\`.`,
    );
  }

  const missing: RequiredComponent[] = [];
  for (const component of requiredComponents) {
    const resolvedRelPath = resolveAliasSpecifier(cwd, `${uiAlias}/${component.fileBaseName}`);
    const exists = resolvedRelPath !== undefined && (await fileExistsWithAnyExtension(cwd, resolvedRelPath));
    if (!exists) missing.push(component);
  }
  if (missing.length > 0) {
    const names = missing.map((c) => c.displayName).join(" and ");
    const fileBaseNames = missing.map((c) => c.fileBaseName).join(" ");
    throw new UsageError(
      `${context} requires the shadcn ${names} component${missing.length > 1 ? "s" : ""}.\n\n` + `Add ${missing.length > 1 ? "them" : "it"} first with your shadcn CLI, e.g.:\n` + `  npx shadcn add ${fileBaseNames}\n\n` + `then re-run \`trim init\`.`,
    );
  }

  const templatePath = TEMPLATE_PATHS[shell][backend];
  const configImport = relativeImportSpecifier(moduleResolution, relativePathBetween(SHELL_PATH.replace(/\.tsx$/, ""), CONFIG_PATH_NO_EXT));
  const contents = readTemplate(templatePath).split(IMPORT_PLACEHOLDER).join(uiAlias).split(CONFIG_IMPORT_PLACEHOLDER).join(configImport);

  const fullPath = path.join(cwd, SHELL_PATH);
  if (!existsSync(fullPath)) {
    return { path: SHELL_PATH, contents, status: "create" };
  }
  const existing = await readFile(fullPath, "utf8");
  return { path: SHELL_PATH, contents, status: existing === contents ? "matches" : "conflict" };
}
