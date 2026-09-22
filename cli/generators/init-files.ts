// Trim CLI — `trim init`'s file generation, planning, and application.
// Split deliberately into three phases (see cli/commands/init.ts for how
// they compose): generate canonical contents (pure), diff against disk to
// build a plan (reads only), then apply the plan (writes only the safe
// part of it, and only when the WHOLE plan is safe — see FileStatus's own
// comment on "conflict"). No file this package doesn't own is ever touched.
//
// Every fresh `trim init` — regardless of `ui.adapter` — also seeds a real,
// ordinary, removable "starter" control (boolean, Trim-managed state) so a
// freshly initialized project renders something immediately: see
// STARTER_CONTROL_SPEC below. It is generated through the EXACT SAME
// generator functions `trim new control` itself uses
// (generateControlFileContents/generateManifestFileContents/
// generateSettingsFileContents, and new-control-plan.ts's own
// controlFilePath for its path) — never a second, forked control-generation
// path. There is nothing runtime-only or hidden about it: delete
// trim/controls/starter.trim.ts, drop "starter" from trim.config.tsx's
// `groups`, and prune it from trim.manifest.ts/trim.settings.ts (a normal
// hand-edit, or just run `trim new control` again for a replacement) and
// it's exactly as if it had never existed.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ProjectInfo,
  ModuleResolutionMode,
} from "../project/detect-project";
import {
  relativeImportSpecifier,
  relativePathBetween,
} from "../project/module-resolution";
import {
  TRIM_JSON_PATH,
  serializeTrimMetadata,
  type Styling,
  type TrimProjectMetadata,
  type TrimUIAdapterValue,
  type TrimShellValue,
} from "../project/trim-metadata";
import { generateSettingsFileContents } from "./settings-file";
import { generateManifestFileContents } from "./manifest-file";
import {
  generateControlFileContents,
  type NewControlSpec,
} from "./control-file";
import { controlFilePath } from "./new-control-plan";
import {
  buildShadcnShellPlan,
  SHELL_PATH,
  type ShadcnVisibleShell,
} from "./shadcn-shell";

export type { Styling, TrimUIAdapterValue, TrimShellValue };

/** The narrowed styling choice — only ever asked (and only ever meaningful) when `ui.adapter === "vanilla"`: shadcn inherits the host's own design system automatically, and headless has no Trim-authored visual output at all, so styling never applies to either. The old third choice ("headless") is now expressed as `adapter: "headless"` instead — see collectInitAnswers's own header. */
export type VanillaStyling = Exclude<Styling, "headless">;

export type InitAnswers = {
  adapter: TrimUIAdapterValue;
  /** Present iff `adapter !== "headless"` — a headless integration has no shell concept at all. */
  shell?: TrimShellValue;
  /** Present iff `adapter === "vanilla"`. */
  styling?: VanillaStyling;
  /**
   * Present iff the "Add Trim theme import to <path>?" question was asked
   * at all (`adapter === "vanilla"` AND a safe global stylesheet was
   * detected — see cli/prompts/init-prompts.ts's own gating). `true` means
   * the user opted in and buildInitPlan should append the import;
   * `false`/`undefined` both mean "leave the stylesheet alone, print the
   * manual instruction instead" — same as before this question existed.
   */
  importStylesheet?: boolean;
};

/**
 * "create": doesn't exist yet. "matches": exists, byte-identical to what
 * we'd generate — nothing to do. "conflict": exists with different
 * content — never written, and its presence blocks the ENTIRE plan (see
 * cli/commands/init.ts: any conflict means nothing in the batch is
 * applied, not just that one file). "update": exists with different
 * content, but is always safe to overwrite. Two cases use it: trim/trim.json,
 * whose whole purpose is recording the CURRENT answers (re-running init with
 * a different answer is expected to update it, not "conflict" with its
 * previous self), and the opt-in global-stylesheet import edit (see
 * buildInitPlan's "Add Trim theme import?" section) — always a pure append
 * to the user's own file, never a rewrite of anything already there, so
 * there is nothing to genuinely conflict with either. An "update" entry
 * does not, on its own, block the plan — but the plan as a whole still only
 * applies if there is no "conflict" anywhere in it.
 */
export type FileStatus = "create" | "matches" | "conflict" | "update";

export type PlannedFile = {
  /** Project-relative, forward-slash path — safe to join with any cwd via path.join. */
  path: string;
  contents: string;
  status: FileStatus;
};

export type InitPlan = {
  files: readonly PlannedFile[];
  /** Human-readable context: shadcn caveats, styling instructions — never file contents. */
  notes: readonly string[];
  /** The exact snippet trim init prints for mounting the generated trim/TrimPanel.tsx. */
  integrationSnippet: string;
};

export const CONFIG_PATH = "trim/trim.config.tsx";
export const MANIFEST_PATH = "trim/trim.manifest.ts";
export const SETTINGS_PATH = "trim/trim.settings.ts";
export const TOKENS_CSS_PATH = "trim/trim.css";
export const TRIM_PANEL_PATH = "trim/TrimPanel.tsx";
export { TRIM_JSON_PATH, SHELL_PATH };

const STARTER_CONTROL_ID = "starter";
export const STARTER_CONTROL_PATH = controlFilePath(STARTER_CONTROL_ID);

const STARTER_CONTROL_SPEC: NewControlSpec = {
  id: STARTER_CONTROL_ID,
  kind: "boolean",
  label: "Starter control",
  allowMultiple: false,
  // Trim-managed: the same default a real `trim new control starter`
  // interactive run would produce for "Boolean" + "Trim-managed" + default
  // value "false" — see cli/generators/control-file.ts's own
  // bindingImportsAndExpression for what this compiles to
  // (`trimSettings.starter`, backed by trim.settings.ts's shared
  // controller).
  binding: { mode: "trim-managed", defaultValue: false },
};

// --- content generators — pure, deterministic ---

/**
 * `ui.shell` is omitted from the generated object entirely when
 * `ui.adapter === "headless"` (no shell concept applies there) — see this
 * step's own spec. `groups` always seeds the one starter "starter" control,
 * regardless of adapter — see this module's own header.
 */
export function generateConfigContents(ui: {
  adapter: TrimUIAdapterValue;
  shell?: TrimShellValue;
}): string {
  const uiBlock =
    ui.adapter === "headless"
      ? `  ui: {\n    adapter: "headless",\n  },\n`
      : `  ui: {\n    adapter: ${JSON.stringify(ui.adapter)},\n    shell: ${JSON.stringify(ui.shell ?? "popover")},\n  },\n`;
  return `// Generated by Trim. Host-owned — customize freely; the Trim CLI only
// edits this file's \`groups\` array structurally, via \`trim attach\`.
import { defineTrimConfig } from "@theharborproject/trim/react";

export default defineTrimConfig({
${uiBlock}  layout: "sections",
  groups: [
    {
      id: "starter",
      label: "Example",
      controls: ["starter"],
    },
  ],
});
`;
}

/** trim/controls/starter.trim.ts's content — generated through control-file.ts's EXACT generator `trim new control` itself calls, given a fixed spec instead of interactive answers. See this module's own header. */
export function generateStarterControlContents(
  moduleResolution: ModuleResolutionMode,
): string {
  return generateControlFileContents(STARTER_CONTROL_SPEC, moduleResolution);
}

/** The one-control case of the same generator `trim new control` uses to regenerate this file — see cli/generators/manifest-file.ts. moduleResolution genuinely matters here (unlike the pre-starter-seed empty case this used to be), since the seeded "starter" control needs a real import specifier. */
export function generateManifestContents(
  moduleResolution: ModuleResolutionMode,
): string {
  return generateManifestFileContents([STARTER_CONTROL_ID], moduleResolution);
}

/** The one-setting case of the same generator `trim new control` uses to regenerate this file — see cli/generators/settings-file.ts. */
export function generateSettingsContents(): string {
  return generateSettingsFileContents([
    { key: STARTER_CONTROL_ID, kind: "boolean", defaultValue: false },
  ]);
}

const PROJECT_TOKEN_TO_TRIM_TOKEN: Record<string, string> = {
  background: "bg",
  foreground: "ink",
  "muted-foreground": "muted",
  border: "line",
  radius: "radius",
};

/**
 * The one generated file whose CONTENT genuinely depends on what's on
 * disk: `identifiedTokens` come from detect-project.ts's scan of the
 * host's own global stylesheet. When nothing recognizable was found, this
 * never invents shadcn/Tailwind variable names — it generates concrete,
 * clearly-labeled starter values instead. Only ever generated for
 * `ui.adapter === "vanilla"` + `styling: "tokens"` — see buildInitPlan.
 */
export function generateTokensCssContents(
  identifiedTokens: readonly string[],
): { contents: string; usedIdentifiedTokens: boolean } {
  if (identifiedTokens.length > 0) {
    const lines = identifiedTokens.map(
      (name) =>
        `  --trim-${PROJECT_TOKEN_TO_TRIM_TOKEN[name]}: var(--${name});`,
    );
    return {
      usedIdentifiedTokens: true,
      contents: `/* Generated by Trim. Maps --trim-* tokens to project variables found in
your global stylesheet. Load this AFTER Trim's generated theme imports
so these values win the cascade. */
[data-trim-panel] {
${lines.join("\n")}
}
`,
    };
  }
  return {
    usedIdentifiedTokens: false,
    contents: `/* Generated by Trim. No recognizable project design tokens (--background,
   --foreground, --border, --muted-foreground, --radius) were found, so
   these are standalone starter values — NOT references to your project's
   real tokens. Edit them, e.g. --trim-bg: var(--your-background-token).
Load this AFTER Trim's generated theme imports so these values win the
cascade. */
[data-trim-panel] {
  --trim-bg: #fff;
  --trim-ink: #111;
  --trim-line: #ccc;
}
`,
  };
}

/**
 * trim/TrimPanel.tsx's content — the one component a host mounts to render
 * the whole panel, regardless of adapter. Always generated by `trim init`
 * (headless included: a headless integration still needs somewhere to
 * register `trimControls` and render <Trim.Panel>, it just renders no
 * chrome of its own). "use client" of its own, on top of the "use client"
 * already carried by @theharborproject/trim/react's exports — every
 * hand-written mount file in this repo's own examples/nextjs fixture does
 * the same, for the same reason: it lets a Next.js Server Component
 * RootLayout import and render this file directly with zero extra
 * client-boundary work, and stays correct even if a future Trim version
 * ever dropped its own package-level pragma.
 *
 * Two shapes, chosen by ui.adapter/ui.shell exactly the way buildInitPlan
 * itself decides whether to generate trim/TrimShell.tsx:
 *  - adapter "shadcn" with a visible shell ("popover"/"dialog"): TrimShell.tsx
 *    (cli/generators/shadcn-shell.ts's templates) renders ONLY
 *    <Panel config={trimConfig} /> — it does not register trimControls into
 *    any registry. So here, TrimPanel wraps <TrimShell/> in <Trim.Registry>
 *    to supply that.
 *  - every other case (vanilla any shell, headless, shadcn + "inline"): no
 *    TrimShell.tsx exists at all, so TrimPanel renders <Trim.Registry> +
 *    <Trim.Panel> directly — the same pattern the pre-TrimPanel manual
 *    integration snippet showed.
 */
export function generateTrimPanelContents(
  ui: { adapter: TrimUIAdapterValue; shell?: TrimShellValue },
  moduleResolution: ModuleResolutionMode,
): string {
  const manifestSpec = relativeImportSpecifier(
    moduleResolution,
    "./trim.manifest",
  );
  const wrapsShell =
    ui.adapter === "shadcn" &&
    (ui.shell === "popover" || ui.shell === "dialog");

  if (wrapsShell) {
    const shellSpec = relativeImportSpecifier(moduleResolution, "./TrimShell");
    return `"use client";

// Generated by Trim (\`trim init\`). Mount <TrimPanel/> wherever the panel
// should be reachable from — this file already carries its own
// "use client", so it can be rendered directly from a Server Component
// (e.g. a Next.js RootLayout) with no extra client-boundary work needed.
// Wraps the generated <TrimShell/> (trim/TrimShell.tsx) in <Trim.Registry>:
// TrimShell only renders <Panel>, it does not register trimControls itself.
// Host-owned from here on — trim init only (re)writes this file when its
// content doesn't already match, exactly like every other generated file.
import { Trim } from "@theharborproject/trim/react";
import { trimControls } from "${manifestSpec}";
import { TrimShell } from "${shellSpec}";

export function TrimPanel() {
  return (
    <Trim.Registry controls={trimControls}>
      <TrimShell />
    </Trim.Registry>
  );
}
`;
  }

  const configSpec = relativeImportSpecifier(moduleResolution, "./trim.config");
  return `"use client";

// Generated by Trim (\`trim init\`). Mount <TrimPanel/> wherever the panel
// should be reachable from — this file already carries its own
// "use client", so it can be rendered directly from a Server Component
// (e.g. a Next.js RootLayout) with no extra client-boundary work needed.
// Host-owned from here on — trim init only (re)writes this file when its
// content doesn't already match, exactly like every other generated file.
import { Trim } from "@theharborproject/trim/react";
import trimConfig from "${configSpec}";
import { trimControls } from "${manifestSpec}";

export function TrimPanel() {
  return (
    <Trim.Registry controls={trimControls}>
      <Trim.Panel config={trimConfig} />
    </Trim.Registry>
  );
}
`;
}

/** The concise instruction `trim init` prints for mounting the generated trim/TrimPanel.tsx — see that file's own generator for why a single component now covers every adapter. */
function buildIntegrationSnippet(project: ProjectInfo): string {
  const panelSpec = relativeImportSpecifier(
    project.moduleResolution,
    "./trim/TrimPanel",
  );
  return `import { TrimPanel } from "${panelSpec}";

<TrimPanel />`;
}

function vanillaThemeImports(
  shell: TrimShellValue | undefined,
): readonly string[] {
  const imports = [
    "@theharborproject/trim/themes/base.css",
    "@theharborproject/trim/themes/controls.css",
  ];

  if (shell === "popover" || shell === "dialog") {
    imports.push("@theharborproject/trim/themes/shell.css");
  }

  return imports;
}

/**
 * Builds the exact `@import` lines appended when the user opts in to an
 * automatic stylesheet edit. `specifiers` contains only the Trim theme
 * layers required by the selected vanilla shell.
 *
 * In "tokens" styling mode, trim/trim.css is appended after those theme
 * layers using a path relative to the detected global stylesheet, so its
 * token overrides win the cascade.
 */
function buildCssImportLines(
  globalStylesheet: string,
  specifiers: readonly string[],
  styling: VanillaStyling,
): string[] {
  const lines = specifiers.map((specifier) => `@import "${specifier}";`);

  if (styling === "tokens") {
    lines.push(
      `@import "${relativePathBetween(globalStylesheet, TOKENS_CSS_PATH)}";`,
    );
  }

  return lines;
}

function cssImportInstruction(
  project: ProjectInfo,
  specifiers: readonly string[],
): string {
  const lines = [
    "Add this to wherever your project loads global styles (a CSS file, or a JS/TS entry point):",
    ...specifiers.map((s) => `  import "${s}";`),
    `  (or, from plain CSS: ${specifiers.map((s) => `@import "${s}";`).join(" ")})`,
  ];
  if (project.globalStylesheet) {
    lines.push(
      `We found ${project.globalStylesheet} as a likely global stylesheet, but did not edit it — add the import there yourself, or wherever fits your project.`,
    );
  }
  return lines.join("\n");
}

async function readIfExists(
  cwd: string,
  relativePath: string,
): Promise<string | undefined> {
  try {
    return await readFile(path.join(cwd, relativePath), "utf8");
  } catch {
    return undefined;
  }
}

function planFile(
  relativePath: string,
  contents: string,
  existing: string | undefined,
): PlannedFile {
  if (existing === undefined)
    return { path: relativePath, contents, status: "create" };
  return {
    path: relativePath,
    contents,
    status: existing === contents ? "matches" : "conflict",
  };
}

/** trim.json is never a "conflict": its whole purpose is recording the current answers, so a rerun with different answers should update it, not block on it. */
function planMetadataFile(
  relativePath: string,
  contents: string,
  existing: string | undefined,
): PlannedFile {
  if (existing === undefined)
    return { path: relativePath, contents, status: "create" };
  return {
    path: relativePath,
    contents,
    status: existing === contents ? "matches" : "update",
  };
}

/**
 * Reads only — never writes (except that it may THROW a UsageError, via
 * ./shadcn-shell.ts's buildShadcnShellPlan, when `ui.adapter === "shadcn"`
 * with a visible shell but the required shadcn Button/Popover/Dialog
 * primitive genuinely isn't installed yet — the same "fail before writing
 * anything" contract every other precondition failure in this CLI follows;
 * see that module's own header).
 *
 * "require the prerequisite before accepting the shadcn adapter" is
 * enforced primarily at the prompt layer (cli/prompts/init-prompts.ts skips
 * that choice entirely when shadcn isn't configured) — this is the
 * defense-in-depth copy for any caller (a test, a future non-interactive
 * mode) that passes `adapter: "shadcn"` directly without a real shadcn
 * setup: it downgrades to "vanilla" for this run (never generates a
 * TrimShell.tsx pointing at components that were never verified to exist),
 * with a note explaining why — trim.json never records `shadcn: true` (or
 * `ui.adapter: "shadcn"`) unless shadcnConfigured independently confirms
 * it. A shadcn setup that DOES exist but is missing the specific
 * Button/Popover/Dialog primitive the chosen shell needs is a different,
 * harder failure (the user asked for real chrome this CLI genuinely cannot
 * generate correctly) — that one throws, exactly like
 * ./shadcn-registry.ts's buildShadcnTemplatePlan does for a control
 * renderer's missing primitive.
 */
export async function buildInitPlan(
  project: ProjectInfo,
  answers: InitAnswers,
): Promise<InitPlan> {
  const notes: string[] = [];

  const requestedAdapter = answers.adapter;
  const shadcnUnavailable =
    requestedAdapter === "shadcn" && !project.shadcnConfigured;

  const effectiveAdapter: TrimUIAdapterValue = shadcnUnavailable
    ? "vanilla"
    : requestedAdapter;

  const effectiveShell: TrimShellValue | undefined =
    effectiveAdapter === "headless"
      ? undefined
      : (answers.shell ?? "popover");

  const effectiveStyling: VanillaStyling =
    answers.styling ?? "default";

  const files: PlannedFile[] = [
    planFile(
      CONFIG_PATH,
      generateConfigContents({
        adapter: effectiveAdapter,
        shell: effectiveShell,
      }),
      await readIfExists(project.cwd, CONFIG_PATH),
    ),
    planFile(
      STARTER_CONTROL_PATH,
      generateStarterControlContents(project.moduleResolution),
      await readIfExists(project.cwd, STARTER_CONTROL_PATH),
    ),
    planFile(
      MANIFEST_PATH,
      generateManifestContents(project.moduleResolution),
      await readIfExists(project.cwd, MANIFEST_PATH),
    ),
    planFile(
      SETTINGS_PATH,
      generateSettingsContents(),
      await readIfExists(project.cwd, SETTINGS_PATH),
    ),
    planFile(
      TRIM_PANEL_PATH,
      generateTrimPanelContents(
        {
          adapter: effectiveAdapter,
          shell: effectiveShell,
        },
        project.moduleResolution,
      ),
      await readIfExists(project.cwd, TRIM_PANEL_PATH),
    ),
  ];

  notes.push(
    `Added a starter "starter" boolean control (${STARTER_CONTROL_PATH}) in trim.config.tsx's "Example" group so this renders something immediately — it's a normal, removable control, exactly like one \`trim new control\` would create by hand.`,
  );

  if (shadcnUnavailable) {
    notes.push(
      'You chose "Use project shadcn", but no components.json was found — shadcn does not appear to be set up in this project. ' +
        "Install/configure it first (https://ui.shadcn.com/docs/installation), then re-run `trim init` to enable it. " +
        'Falling back to the vanilla UI adapter for this run — trim/trim.json records ui.adapter: "vanilla" for now.',
    );
  } else if (effectiveAdapter === "shadcn") {
    notes.push(
      "shadcn preference recorded in trim/trim.json — controls installed via `trim add @shadcn/controls/...` will use your project's own components.",
    );
  }

  if (
    effectiveAdapter === "shadcn" &&
    (effectiveShell === "popover" || effectiveShell === "dialog")
  ) {
    const shellPlan = await buildShadcnShellPlan(
      project.cwd,
      effectiveShell as ShadcnVisibleShell,
      project.moduleResolution,
    );

    files.push({
      path: shellPlan.path,
      contents: shellPlan.contents,
      status: shellPlan.status,
    });

    notes.push(
      `Generated ${SHELL_PATH} — a host-local <TrimShell/> wrapping <Trim.Panel> in your shadcn Button + ${
        effectiveShell === "popover" ? "Popover" : "Dialog"
      }. ${TRIM_PANEL_PATH} wraps <TrimShell/> in <Trim.Registry> for you — render <TrimPanel /> wherever the accessibility panel should appear (nothing else needs to render <TrimShell/> or <Trim.Panel> directly).`,
    );
  } else if (
    effectiveAdapter === "shadcn" &&
    effectiveShell === "inline"
  ) {
    notes.push(
      `ui.shell is "inline" — no popover/dialog chrome is generated; render <TrimPanel /> (${TRIM_PANEL_PATH}) directly wherever you want it to appear. Shadcn templates are still available for controls, e.g. \`trim add @shadcn/controls/boolean\`.`,
    );
  }

  const metadata: TrimProjectMetadata = {
    version: 1,
    shadcn: effectiveAdapter === "shadcn",

    // "shadcn"/"headless" both mean "Trim generates no CSS of its own" for
    // the purposes of the one place this legacy field still drives
    // behavior (cli/generators/example-plan.ts's panel CSS import choice,
    // which predates ui.adapter) — see this module's header comment on
    // VanillaStyling for why only "vanilla" ever has a real styling
    // choice.
    styling:
      effectiveAdapter === "vanilla"
        ? effectiveStyling
        : "headless",

    ui:
      effectiveAdapter === "headless"
        ? { adapter: "headless" }
        : {
            adapter: effectiveAdapter,
            shell: effectiveShell,
          },
  };

  files.push(
    planMetadataFile(
      TRIM_JSON_PATH,
      serializeTrimMetadata(metadata),
      await readIfExists(project.cwd, TRIM_JSON_PATH),
    ),
  );

  if (effectiveAdapter === "vanilla") {
    const themeImports = vanillaThemeImports(effectiveShell);

    let cssImportSpecifiers: readonly string[];

    if (effectiveStyling === "default") {
      cssImportSpecifiers = themeImports;
    } else {
      const {
        contents,
        usedIdentifiedTokens,
      } = generateTokensCssContents(
        project.identifiedProjectTokens,
      );

      files.push(
        planFile(
          TOKENS_CSS_PATH,
          contents,
          await readIfExists(project.cwd, TOKENS_CSS_PATH),
        ),
      );

      notes.push(
        usedIdentifiedTokens
          ? `Mapped ${project.identifiedProjectTokens.length} token(s) found in ${project.globalStylesheet} into ${TOKENS_CSS_PATH}.`
          : `No recognizable project design tokens were found${
              project.globalStylesheet
                ? ` in ${project.globalStylesheet}`
                : ""
            } — generated ${TOKENS_CSS_PATH} with standalone starter values instead of guessed token names. Edit it to reference your own tokens.`,
      );

      cssImportSpecifiers = [
        ...themeImports,
        `./${TOKENS_CSS_PATH}`,
      ];
    }

    // "Add Trim theme import to <path>?" — only ever a real InitAnswers
    // field when cli/prompts/init-prompts.ts actually asked it (adapter
    // "vanilla" AND project.globalStylesheet !== undefined at prompt time;
    // see InitAnswers.importStylesheet's own doc). `true` here therefore
    // also implies a safe stylesheet was found, but the check is repeated
    // explicitly (never trust a caller that builds InitAnswers by hand,
    // e.g. a test, to have upheld that pairing).
    if (
      answers.importStylesheet === true &&
      project.globalStylesheet !== undefined
    ) {
      const importLines = buildCssImportLines(
        project.globalStylesheet,
        themeImports,
        effectiveStyling,
      );

      const existingCss =
        (await readIfExists(
          project.cwd,
          project.globalStylesheet,
        )) ?? "";

      const missingImportLines = importLines.filter(
        (line) => !existingCss.includes(line),
      );

      if (missingImportLines.length === 0) {
        files.push({
          path: project.globalStylesheet,
          contents: existingCss,
          status: "matches",
        });

        notes.push(
          `Trim theme imports already present in ${project.globalStylesheet} — nothing to add.`,
        );
      } else {
        const separator =
          existingCss.length > 0 &&
          !existingCss.endsWith("\n")
            ? "\n"
            : "";

        files.push({
          path: project.globalStylesheet,
          contents: `${existingCss}${separator}${missingImportLines.join("\n")}\n`,
          status: "update",
        });

        notes.push(
          `Added ${missingImportLines.length} missing Trim theme import(s) to ${project.globalStylesheet}.`,
        );
      }
    } else {
      notes.push(
        cssImportInstruction(
          project,
          cssImportSpecifiers,
        ),
      );
    }
  } else if (effectiveAdapter === "shadcn") {
    notes.push(
      "Using your project's own shadcn design system — Trim generates no CSS of its own here; controls installed via `trim add @shadcn/...` inherit your theme automatically.",
    );
  } else {
    notes.push(
      "Fully headless — no Trim CSS import needed. Style [data-trim-panel]/[data-trim-control]/etc. yourself using Trim's data-attribute contract.",
    );
  }

  return {
    files,
    notes,
    integrationSnippet: buildIntegrationSnippet(project),
  };
}

/**
 * Writes "create" and "update" entries; "matches" needs no write;
 * "conflict" is never overwritten. Callers (cli/commands/init.ts) are
 * expected to check for "conflict" BEFORE calling this at all — plan
 * application is all-or-nothing at the command level, not per file — but
 * this still individually skips any conflict entry as a defensive
 * safeguard, never as the primary transactional guarantee.
 */
export async function applyInitPlan(
  cwd: string,
  plan: InitPlan,
): Promise<void> {
  for (const file of plan.files) {
    if (file.status !== "create" && file.status !== "update") continue;
    const fullPath = path.join(cwd, file.path);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.contents, "utf8");
  }
}
