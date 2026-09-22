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
// Three, and only three, project states are accepted (see buildExamplePlan
// below) — everything else refuses, writing nothing:
//
//   1. The EXACT canonical post-`trim init` starter (one "starter"
//      control, byte-identical to what init-files.ts generates, alone in
//      trim.config.tsx's groups) — this is REPLACED by @default/example in
//      one transaction: the starter's control file/manifest entry/settings
//      entry/config group are gone, @default/example's own is installed,
//      as if `trim init` had never seeded a starter at all. See
//      buildReplacePlan/applyExamplePlan's replace branch below.
//   2. A genuinely empty Trim setup (zero controls, zero config groups) —
//      unchanged from this installer's original behavior: plain
//      buildNewControlPlan/applyNewControlPlan + gatherAttachInfo/
//      buildAttachEdit/applyAttachEdit calls, exactly like `trim new
//      control`/`trim attach` themselves.
//   3. Anything else — a modified starter, extra controls, extra config
//      groups, a hand-authored control that merely happens to be named
//      "starter" — refuses with a UsageError. Case 1's canonical-state
//      check is by CONTENT (byte-compare the 3 generated files, AST-parse
//      trim.config.tsx's one group), never by id alone: an id match with a
//      content mismatch falls through to this case, never to case 1's
//      destructive replace.
//
// For cases 1 and 2 alike, every precondition (including, for case 1,
// @default/example's own — the 3 literal-file conflict checks, the
// theme/contrast/animations id-conflict checks, the settings duplicate-key
// check) is validated READ-ONLY, before any write — that is what makes
// "check everything up front, then apply" an honest transactional boundary
// here, the same way it is for init/new-control/attach, without needing
// new atomic-rename machinery. Case 1's write phase additionally orders
// its writes so the one write that can still fail for reasons validation
// cannot fully rule out (deleting starter.trim.ts — OS permissions, a
// concurrent external change) happens LAST, after every other write has
// already succeeded — see applyExamplePlan's replace branch for why that
// ordering is what keeps "starter removed, example half-installed"
// structurally impossible.
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectProject, type ModuleResolutionMode } from "../project/detect-project";
import { readTrimMetadata, type Styling } from "../project/trim-metadata";
import { loadTypeScript, type TS } from "../project/resolve-typescript";
import { parseTrimConfig, computeReplaceGroupsEdit, UnsupportedConfigShapeError, type ParsedConfig, type GroupSpec } from "../project/trim-config-ast";
import { parseExistingManagedSettings, generateSettingsFileContents, type TrimManagedSetting } from "./settings-file";
import { generateManifestFileContents } from "./manifest-file";
import { generateControlFileContents, type NewControlSpec } from "./control-file";
import {
  listExistingControlIds,
  controlAlreadyExists,
  controlFilePath,
  toManagedSetting,
  CONTROLS_DIR,
  MANIFEST_PATH,
  SETTINGS_PATH,
} from "./new-control-plan";
import { buildNewControlPlan, applyNewControlPlan } from "./new-control-plan";
import { gatherAttachInfo, buildAttachEdit, applyAttachEdit, CONFIG_PATH, type AttachAnswers } from "./attach-plan";
import {
  STARTER_CONTROL_PATH,
  generateStarterControlContents,
  generateManifestContents as generateStarterManifestContents,
  generateSettingsContents as generateStarterSettingsContents,
} from "./init-files";
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

/** The final groups @default/example attaches into, derived from ATTACH_STEPS — used only by the canonical-starter replacement path (case 1) to build the whole `groups` array in one pass, instead of the incremental gatherAttachInfo/buildAttachEdit sequence case 2 uses (see this module's header). Map insertion order matches ATTACH_STEPS' own order, so "vision" comes before "motion" here too. */
function buildFinalGroups(): readonly GroupSpec[] {
  const groups = new Map<string, { label: string; controlIds: string[] }>();
  for (const step of ATTACH_STEPS) {
    const group = groups.get(step.groupId) ?? { label: step.groupLabel, controlIds: [] };
    group.controlIds.push(step.controlId);
    groups.set(step.groupId, group);
  }
  return [...groups.entries()].map(([id, group]) => ({ id, label: group.label, controlIds: group.controlIds }));
}

async function readIfExists(cwd: string, relativePath: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(cwd, relativePath), "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Byte/structure-compares the project's current starter against exactly
 * what `trim init` would generate today — never by id alone (see this
 * module's header). All 4 checks must pass: a hand-edited starter, an
 * extra/modified group alongside it, or any other departure from the
 * canonical shape fails this and the caller refuses (case 3) rather than
 * destroying anything. trim.config.tsx's check goes through the AST parser
 * (already parsed by the caller) rather than a byte-compare — config edits
 * are the one of these 4 files most likely to have been reformatted by a
 * host tool, and an AST-level check is format-tolerant where a byte
 * compare isn't; the other 3 stay byte-compares (see this module's header
 * on why a false-negative there is safe by construction — it only ever
 * leads to a refusal, never to a destructive replace).
 */
async function isCanonicalStarterState(cwd: string, moduleResolution: ModuleResolutionMode, settingsSource: string | undefined, parsedConfig: ParsedConfig): Promise<boolean> {
  const controlSource = await readIfExists(cwd, STARTER_CONTROL_PATH);
  if (controlSource !== generateStarterControlContents(moduleResolution)) return false;

  const manifestSource = await readIfExists(cwd, MANIFEST_PATH);
  if (manifestSource !== generateStarterManifestContents(moduleResolution)) return false;

  if (settingsSource !== generateStarterSettingsContents()) return false;

  if (parsedConfig.groups.length !== 1) return false;
  const [group] = parsedConfig.groups;
  return group.id === "starter" && group.label === "Example" && group.items.length === 1 && group.items[0].ref === "starter";
}

export type ExampleReplacePlan = {
  /** Project-relative path of the starter control file this replaces — deleted LAST, after every write below has succeeded (see applyExamplePlan). */
  starterControlPath: string;
  controlFiles: readonly { path: string; contents: string }[];
  manifestFile: { path: string; contents: string };
  settingsFile: { path: string; contents: string };
  configFile: { fullPath: string; contents: string };
  attachedLabels: readonly string[];
};

/**
 * Only called once the caller has confirmed isCanonicalStarterState — so
 * theme/contrast/animations are guaranteed not to already exist and
 * trim.settings.ts is guaranteed to hold only the "starter" key, but every
 * one of @default/example's own preconditions is still re-verified
 * explicitly here (never trusted to "obviously" follow), the same
 * belt-and-suspenders discipline buildNewControlPlan's own duplicate-
 * settings-key check uses. Reads only — never writes; builds the ENTIRE
 * final desired content of every file (control files, manifest, settings,
 * config) in memory, via the same pure generators `trim new control`/
 * `trim attach` use, so applyExamplePlan's write phase has nothing left to
 * compute or validate.
 */
async function buildReplacePlan(cwd: string, moduleResolution: ModuleResolutionMode, existingSettings: readonly TrimManagedSetting[], parsedConfig: ParsedConfig, configSource: string, configFullPath: string, tsc: TS): Promise<ExampleReplacePlan> {
  for (const spec of CONTROL_SPECS) {
    if (controlAlreadyExists(cwd, spec.id)) {
      throw new UsageError(
        `control "${spec.id}" already exists at ${controlFilePath(spec.id)}, which should not happen alongside a canonical trim init starter — resolve the inconsistency by hand before retrying.`,
      );
    }
  }

  const managedSettings = CONTROL_SPECS.filter((spec) => spec.binding.mode === "trim-managed").map(toManagedSetting);
  for (const setting of managedSettings) {
    if (existingSettings.some((s) => s.key === setting.key)) {
      throw new UsageError(
        `${SETTINGS_PATH} already has a Trim-managed setting for "${setting.key}", which should not happen alongside a canonical trim init starter — resolve the inconsistency by hand before retrying.`,
      );
    }
  }

  const controlFiles = CONTROL_SPECS.map((spec) => ({ path: controlFilePath(spec.id), contents: generateControlFileContents(spec, moduleResolution) }));
  const manifestFile = { path: MANIFEST_PATH, contents: generateManifestFileContents(CONTROL_SPECS.map((spec) => spec.id), moduleResolution) };
  const settingsFile = { path: SETTINGS_PATH, contents: generateSettingsFileContents(managedSettings) };

  let configContents: string;
  try {
    configContents = computeReplaceGroupsEdit(parsedConfig, configSource, ["starter"], buildFinalGroups());
  } catch (error) {
    if (error instanceof UnsupportedConfigShapeError) throw new UsageError(error.message);
    throw error;
  }
  try {
    parseTrimConfig(tsc, configContents, configFullPath); // final structural sanity check — same discipline buildAttachEdit's own re-parse uses — before this is ever returned to a caller that might write it.
  } catch (error) {
    throw new UsageError(`the replacement config would not parse as valid TypeScript (${error instanceof Error ? error.message : String(error)}) — nothing was written. This should not happen; please report it.`);
  }

  return {
    starterControlPath: STARTER_CONTROL_PATH,
    controlFiles,
    manifestFile,
    settingsFile,
    configFile: { fullPath: configFullPath, contents: configContents },
    attachedLabels: ATTACH_STEPS.map((step) => `${step.controlId} -> ${step.groupLabel}`),
  };
}

export type ExamplePlan = {
  literalFiles: readonly TemplateFilePlan[];
  /**
   * Present only for case 1 (canonical-starter replacement). Absent means
   * case 2 (genuinely empty) — applyExamplePlan falls back to the
   * original buildNewControlPlan/applyNewControlPlan + gatherAttachInfo/
   * buildAttachEdit/applyAttachEdit sequence for that case, unchanged.
   */
  replace?: ExampleReplacePlan;
};

/**
 * Reads only — never writes. Throws UsageError for any reason nothing
 * should be written: project not initialized, a literal template file
 * would conflict with something already on disk, or the project is in
 * none of the 3 accepted states (see this module's header). For case 2,
 * the 3 control declarations + manifest + settings + 4 config edits are
 * NOT part of this returned plan object — see this module's header for why
 * they cannot fail once this function has returned successfully, and
 * applyExamplePlan below performs them directly. For case 1, the ENTIRE
 * replacement (every file's final content) is already computed inside
 * `replace` — see buildReplacePlan.
 */
export async function buildExamplePlan(cwd: string): Promise<ExamplePlan> {
  const metadata = await readTrimMetadata(cwd);
  if (!metadata) {
    throw new UsageError("no trim/trim.json found — this project hasn't been initialized for Trim yet. Run `trim init` first.");
  }
  const moduleResolution = detectProject(cwd).moduleResolution;

  const existingControlIds = await listExistingControlIds(cwd);

  const settingsSource = await readIfExists(cwd, SETTINGS_PATH);
  const existingSettings = settingsSource ? parseExistingManagedSettings(settingsSource) : [];

  const tsc = loadTypeScript();
  const configFullPath = path.join(cwd, CONFIG_PATH);
  let configSource: string;
  try {
    configSource = await readFile(configFullPath, "utf8");
  } catch {
    throw new UsageError(`could not read ${CONFIG_PATH} — run \`trim init\` first.`);
  }
  let parsedConfig: ParsedConfig;
  try {
    parsedConfig = parseTrimConfig(tsc, configSource, configFullPath);
  } catch (error) {
    const detail = error instanceof UnsupportedConfigShapeError ? error.message : error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `@default/example could not safely verify this project's current Trim setup (${detail}). It only installs into a project trim init just produced (either untouched, or genuinely empty), before trim.config.tsx has been hand-edited in an unrecognized way.`,
    );
  }

  let replace: ExampleReplacePlan | undefined;

  if (existingControlIds.length === 0) {
    // Case 2 candidate: genuinely empty legacy setup — unchanged
    // precondition from this installer's original behavior.
    if (existingSettings.length > 0) {
      throw new UsageError(`@default/example can only be installed into an empty Trim setup. ${SETTINGS_PATH} already has Trim-managed setting(s) (${existingSettings.map((s) => s.key).join(", ")}).`);
    }
    if (parsedConfig.groups.length > 0) {
      throw new UsageError(
        `@default/example can only be installed into an empty Trim setup. This project already contains Trim configuration (${CONFIG_PATH} already has ${parsedConfig.groups.length} group(s)).`,
      );
    }
    // else: genuinely empty — proceed with case 2 below, replace stays undefined.
  } else if (existingControlIds.length === 1 && existingControlIds[0] === "starter") {
    // The only id that ever triggers the canonical-starter check — but the
    // check itself is by CONTENT, never by id alone (see this module's
    // header and isCanonicalStarterState's own comment): a hand-authored
    // control that merely happens to be named "starter" fails the content
    // checks below and falls through to the same refusal every other
    // non-canonical state gets, never to the destructive replace.
    const canonical = await isCanonicalStarterState(cwd, moduleResolution, settingsSource, parsedConfig);
    if (!canonical) {
      throw new UsageError(
        `@default/example can only be installed into an empty Trim setup, or replace an untouched \`trim init\` starter. This project's "starter" control/${MANIFEST_PATH}/${SETTINGS_PATH}/${CONFIG_PATH} do not exactly match what a fresh \`trim init\` generates (hand-edited, or otherwise inconsistent) — nothing was changed. Resolve or remove the starter by hand before retrying.`,
      );
    }
    replace = await buildReplacePlan(cwd, moduleResolution, existingSettings, parsedConfig, configSource, configFullPath, tsc);
  } else {
    throw new UsageError(
      `@default/example can only be installed into an empty Trim setup. This project already has ${existingControlIds.length} declared control(s) (${existingControlIds.join(", ")}) under ${CONTROLS_DIR}/.`,
    );
  }

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

  return { literalFiles, replace };
}

export type ExampleApplyResult = {
  controlFilePaths: readonly string[];
  attachedLabels: readonly string[];
  /** Present only for case 1 — the starter control file that was removed as part of the replacement. */
  removedStarterPath?: string;
};

/** Only ever called with a plan buildExamplePlan produced with no "conflict" entries — see cli/commands/add.ts. */
export async function applyExamplePlan(cwd: string, plan: ExamplePlan, moduleResolution: ModuleResolutionMode): Promise<ExampleApplyResult> {
  for (const file of plan.literalFiles) {
    if (file.status === "create") await applyTemplateFilePlan(cwd, file);
  }

  if (plan.replace) {
    const { replace } = plan;
    for (const file of replace.controlFiles) {
      const fullPath = path.join(cwd, file.path);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.contents, "utf8");
    }
    await writeFile(path.join(cwd, replace.manifestFile.path), replace.manifestFile.contents, "utf8");
    await writeFile(path.join(cwd, replace.settingsFile.path), replace.settingsFile.contents, "utf8");
    await writeFile(replace.configFile.fullPath, replace.configFile.contents, "utf8");
    // Deleting starter.trim.ts LAST, after every other write above has
    // already succeeded: this is the one write in this whole path that can
    // still fail for reasons validation can't fully rule out (OS
    // permissions, a concurrent external change) — see this module's
    // header. Ordered last, the worst case on failure is an orphaned,
    // unreferenced starter.trim.ts still on disk (inert — nothing imports
    // it anymore, manifest/settings/config no longer mention it) — never
    // "starter gone, example half-installed."
    await unlink(path.join(cwd, replace.starterControlPath));

    return { controlFilePaths: replace.controlFiles.map((f) => f.path), attachedLabels: replace.attachedLabels, removedStarterPath: replace.starterControlPath };
  }

  const controlFilePaths: string[] = [];
  for (const spec of CONTROL_SPECS) {
    const controlPlan = await buildNewControlPlan(cwd, spec, moduleResolution);
    await applyNewControlPlan(cwd, controlPlan);
    controlFilePaths.push(controlPlan.controlFile.path);
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

  return { controlFilePaths, attachedLabels };
}
