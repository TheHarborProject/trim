// Trim CLI — `trim add @default/example`'s installer.
//
// Philosophy: everything this installs that is normally CLI-GENERATED
// (trim/controls/*.trim.ts, trim/trim.manifest.ts, trim/trim.settings.ts,
// trim/trim.config.tsx's groups) is produced by calling the exact same
// generators `trim new control`/`trim attach` use — never a second,
// hand-authored template copy of them. That makes drift between "what
// trim new control would generate" and "what trim add @default/example
// installs" structurally impossible: they are, literally, the same code
// path, given a fixed set of specs instead of interactive answers. Only
// the few files NOT normally CLI-generated — the custom renderer, the
// host state stand-in, the panel entry point — are genuine copy-paste
// templates, and those are copied from examples/default/ at BUILD time
// (see package.json's build script and templates-path.ts), so there is
// exactly one authored copy of each, not two.
//
// Constrained to installing ONLY into a project whose Trim setup is still
// completely empty (see checkProjectIsEmpty below) — the same one an
// `trim init` run just produced, before anything else has touched it.
// This sidesteps ever having to invent a "merge" semantics for an
// already-customized project: given that constraint, every one of this
// installer's steps is GUARANTEED to succeed once the precondition checks
// (all read-only) and the 3 literal template files' conflict checks (also
// read-only) pass, because every input from that point on is fixed data,
// not something a conflicting/partial disk state could still reject. That
// is what makes "check everything up front, then apply" an honest
// transactional boundary here, the same way it is for init/new-control/
// attach, without needing new atomic-rename machinery.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModuleResolutionMode } from "../project/detect-project";
import { readTrimMetadata, type Styling, type TrimProjectMetadata } from "../project/trim-metadata";
import { loadTypeScript } from "../project/resolve-typescript";
import { parseTrimConfig, UnsupportedConfigShapeError } from "../project/trim-config-ast";
import { parseExistingManagedSettings } from "./settings-file";
import { listExistingControlIds, CONTROLS_DIR, SETTINGS_PATH } from "./new-control-plan";
import { buildNewControlPlan, applyNewControlPlan, type NewControlPlan } from "./new-control-plan";
import { gatherAttachInfo, buildAttachEdit, applyAttachEdit, CONFIG_PATH, type AttachAnswers } from "./attach-plan";
import type { NewControlSpec } from "./control-file";
import { applyTemplateFilePlan, type TemplateFilePlan } from "./template-registry";
import { readTemplate } from "../templates-path";
import { UsageError } from "../dispatch";

const STATIC_LITERAL_FILES: readonly { templatePath: string; targetPath: string }[] = [
  { templatePath: "default/example/host/contrast-store.ts", targetPath: "host/contrast-store.ts" },
  { templatePath: "default/example/trim/renderers/custom-contrast.tsx", targetPath: "trim/renderers/custom-contrast.tsx" },
];

const EXAMPLE_PANEL_TARGET_PATH = "example-panel.tsx";
const DEFAULT_THEME_CSS_IMPORT = 'import "@theharborproject/trim/themes/default.css";\n';

/**
 * The panel entry's CSS import is the ONE place @default/example's fixed
 * template text has to vary with the project's own `trim init` styling
 * choice (trim/trim.json) — everything else this installs is identical
 * regardless of it. Never touches global CSS itself (no file this writes
 * modifies trim/trim.css or any other stylesheet) — this only changes
 * which stylesheet the installed panel imports, mirroring `trim init`'s
 * own per-styling notes:
 * - "default": Trim's own theme (unchanged from examples/default's own file).
 * - "tokens": trim init already generated trim/trim.css mapping project
 *   tokens onto Trim's CSS variables — import THAT instead, never the
 *   package's own default theme, so the example works through it.
 * - "headless": no CSS import at all — the example is meant to look
 *   unstyled, per that explicit choice; never secretly opt it back in.
 */
function buildExamplePanelContents(styling: Styling): string {
  const base = readTemplate("default/example/example-panel.tsx");
  if (!base.includes(DEFAULT_THEME_CSS_IMPORT)) {
    throw new Error("example-panel.tsx template no longer contains the expected default-theme CSS import line — this is a Trim CLI bug, not a user-facing condition.");
  }
  if (styling === "default") return base;
  if (styling === "tokens") return base.replace(DEFAULT_THEME_CSS_IMPORT, 'import "./trim/trim.css";\n');
  return base.replace(DEFAULT_THEME_CSS_IMPORT, "");
}

/** The exact demonstration examples/default hand-authors — see that directory's own README for what each concept proves. Fixed, non-interactive: this installer never prompts. */
const CONTROL_SPECS: readonly NewControlSpec[] = [
  {
    id: "theme",
    kind: "segmented",
    label: "Theme",
    allowMultiple: false,
    options: [
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
      { value: "system", label: "System" },
    ],
    binding: { mode: "trim-managed", defaultValue: "system" },
  },
  {
    id: "contrast",
    kind: "boolean",
    label: "High contrast",
    allowMultiple: false,
    binding: { mode: "callback", importPath: "host/contrast-store", getSymbol: "getContrast", setSymbol: "setContrast", subscribeSymbol: "subscribeContrast" },
  },
  {
    id: "animations",
    kind: "segmented",
    label: "Animations",
    allowMultiple: true,
    options: [
      { value: "full", label: "Full" },
      { value: "reduced", label: "Reduced" },
    ],
    binding: { mode: "trim-managed", defaultValue: "full" },
  },
];

/**
 * theme/contrast/animations attach into "Vision" (append order); animations
 * attaches a SECOND time into "Motion" — the is_unique: false demonstration
 * (both attachments share the exact same binding). "contrast" is attached
 * as a bare id here, NOT the { id, component: CustomContrast } object form
 * examples/default's own trim.config.tsx uses: `trim attach` (whose real
 * generator this reuses) never generates a component override by design
 * (see cli/commands/attach.ts's own header) — the installed project's
 * printed output tells you how to swap it in by hand, the same "copy the
 * hint, never auto-edit the config" rule @default/controls/* renderers
 * follow.
 */
const ATTACH_STEPS: readonly { controlId: string; groupId: string; groupLabel: string }[] = [
  { controlId: "theme", groupId: "vision", groupLabel: "Vision" },
  { controlId: "contrast", groupId: "vision", groupLabel: "Vision" },
  { controlId: "animations", groupId: "vision", groupLabel: "Vision" },
  { controlId: "animations", groupId: "motion", groupLabel: "Motion" },
];

/**
 * Throws a UsageError describing exactly what isn't empty. Every check is
 * read-only. A config this module cannot structurally parse is treated the
 * same as "not verifiably empty" — never assumed empty, the same
 * conservative default trim-config-ast.ts itself uses.
 */
async function checkProjectIsEmpty(cwd: string): Promise<TrimProjectMetadata> {
  const metadata = await readTrimMetadata(cwd);
  if (!metadata) {
    throw new UsageError("no trim/trim.json found — this project hasn't been initialized for Trim yet. Run `trim init` first.");
  }

  const existingControlIds = await listExistingControlIds(cwd);
  if (existingControlIds.length > 0) {
    throw new UsageError(
      `@default/example can only be installed into an empty Trim setup. This project already has ${existingControlIds.length} declared control(s) (${existingControlIds.join(", ")}) under ${CONTROLS_DIR}/.`,
    );
  }

  const settingsSource = await readIfExists(cwd, SETTINGS_PATH);
  const existingSettings = settingsSource ? parseExistingManagedSettings(settingsSource) : [];
  if (existingSettings.length > 0) {
    throw new UsageError(`@default/example can only be installed into an empty Trim setup. ${SETTINGS_PATH} already has Trim-managed setting(s) (${existingSettings.map((s) => s.key).join(", ")}).`);
  }

  const tsc = loadTypeScript();
  const configFullPath = path.join(cwd, CONFIG_PATH);
  let configSource: string;
  try {
    configSource = await readFile(configFullPath, "utf8");
  } catch {
    throw new UsageError(`could not read ${CONFIG_PATH} — run \`trim init\` first.`);
  }
  let groupCount: number;
  try {
    groupCount = parseTrimConfig(tsc, configSource, configFullPath).groups.length;
  } catch (error) {
    const detail = error instanceof UnsupportedConfigShapeError ? error.message : error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `@default/example could not safely verify that ${CONFIG_PATH} is still empty (${detail}). It only installs into a project trim init just created, before trim.config.tsx has been hand-edited.`,
    );
  }
  if (groupCount > 0) {
    throw new UsageError(`@default/example can only be installed into an empty Trim setup. This project already contains Trim configuration (${CONFIG_PATH} already has ${groupCount} group(s)).`);
  }

  return metadata;
}

async function readIfExists(cwd: string, relativePath: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(cwd, relativePath), "utf8");
  } catch {
    return undefined;
  }
}

export type ExamplePlan = {
  literalFiles: readonly TemplateFilePlan[];
};

/**
 * Reads only — never writes. Throws UsageError for any reason nothing
 * should be written (project not empty, a literal template file would
 * conflict with something already on disk). The 3 control declarations +
 * manifest + settings + 4 config edits are NOT part of this returned plan
 * object — see this module's header for why they cannot fail once this
 * function has returned successfully, and applyExamplePlan below performs
 * them directly.
 */
export async function buildExamplePlan(cwd: string): Promise<ExamplePlan> {
  const metadata = await checkProjectIsEmpty(cwd);

  const files = [...STATIC_LITERAL_FILES.map((f) => ({ targetPath: f.targetPath, contents: readTemplate(f.templatePath) })), { targetPath: EXAMPLE_PANEL_TARGET_PATH, contents: buildExamplePanelContents(metadata.styling) }];

  const literalFiles: TemplateFilePlan[] = [];
  for (const file of files) {
    const existing = await readIfExists(cwd, file.targetPath);
    literalFiles.push({
      path: file.targetPath,
      contents: file.contents,
      status: existing === undefined ? "create" : existing === file.contents ? "matches" : "conflict",
    });
  }

  return { literalFiles };
}

export type ExampleApplyResult = {
  controlPlans: readonly NewControlPlan[];
  attachedLabels: readonly string[];
};

/** Only ever called with a plan buildExamplePlan produced with no "conflict" entries — see cli/commands/add.ts. */
export async function applyExamplePlan(cwd: string, plan: ExamplePlan, moduleResolution: ModuleResolutionMode): Promise<ExampleApplyResult> {
  for (const file of plan.literalFiles) {
    if (file.status === "create") await applyTemplateFilePlan(cwd, file);
  }

  const controlPlans: NewControlPlan[] = [];
  for (const spec of CONTROL_SPECS) {
    const controlPlan = await buildNewControlPlan(cwd, spec, moduleResolution);
    await applyNewControlPlan(cwd, controlPlan);
    controlPlans.push(controlPlan);
  }

  const attachedLabels: string[] = [];
  for (const step of ATTACH_STEPS) {
    const info = await gatherAttachInfo(cwd, step.controlId);
    const existingGroup = info.parsed.groups.find((g) => g.id === step.groupId);
    const answers: AttachAnswers = existingGroup
      ? { mode: "existing-group", groupId: step.groupId, position: "append" }
      : { mode: "new-group", groupId: step.groupId, groupLabel: step.groupLabel };
    const newConfigText = buildAttachEdit(info, answers);
    await applyAttachEdit(info.configFullPath, newConfigText);
    attachedLabels.push(`${step.controlId} -> ${step.groupLabel}`);
  }

  return { controlPlans, attachedLabels };
}
