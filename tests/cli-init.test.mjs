// Tests for `trim init` (cli/commands/init.ts, cli/generators/init-files.ts,
// cli/generators/shadcn-shell.ts, cli/generators/settings-file.ts,
// cli/project/detect-project.ts, cli/project/module-resolution.ts,
// cli/project/trim-metadata.ts).
//
// Exercises the "detect project -> build plan -> apply plan" pipeline
// directly with fixture projects and predetermined answers — no TTY, no
// real prompting (see cli/prompts/init-prompts.ts's own header for the
// readline quirk that shaped its design; the interactive path itself is
// smoke-tested separately below via a real piped subprocess, once, to
// prove the whole prompt->plan->apply chain actually works end to end).
//
// Runs the real `npm run build` (like package-exports/example/cli tests) —
// generated-file typechecking needs the real dist/ output, self-referenced
// by the package's own name exactly as an installed consumer would resolve
// it, so fixtures live inside the repo tree (self-reference only works
// there), never under /tmp.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });

const require = createRequire(import.meta.url);
const { detectProject, stripJsonComments } = require(
  path.join(root, "dist/cli/project/detect-project.js"),
);
const { relativeImportSpecifier } = require(
  path.join(root, "dist/cli/project/module-resolution.js"),
);
const { parseTrimMetadata, serializeTrimMetadata, TRIM_JSON_PATH } = require(
  path.join(root, "dist/cli/project/trim-metadata.js"),
);
const {
  buildInitPlan,
  applyInitPlan,
  generateConfigContents,
  generateManifestContents,
  generateSettingsContents,
  generateTokensCssContents,
  generateStarterControlContents,
  generateTrimPanelContents,
  CONFIG_PATH,
  MANIFEST_PATH,
  SETTINGS_PATH,
  TOKENS_CSS_PATH,
  STARTER_CONTROL_PATH,
  SHELL_PATH,
  TRIM_PANEL_PATH,
} = require(path.join(root, "dist/cli/generators/init-files.js"));
const { runInitCommand } = require(
  path.join(root, "dist/cli/commands/init.js"),
);
const { collectInitAnswers } = require(
  path.join(root, "dist/cli/prompts/init-prompts.js"),
);
const { UsageError } = require(path.join(root, "dist/cli/dispatch.js"));

const testRoot = mkdtempSync(path.join(root, ".trim-cli-init-test-"));
function fixture(name, { tsconfig = "{}", files = {} } = {}) {
  const dir = path.join(testRoot, name);
  mkdirSync(dir, { recursive: true });
  if (tsconfig !== null)
    writeFileSync(path.join(dir, "tsconfig.json"), tsconfig, "utf8");
  for (const [relPath, contents] of Object.entries(files)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents, "utf8");
  }
  return dir;
}
const swallowLogs = async (fn) => {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
};
// config, starter control, manifest, settings, TrimPanel.tsx, trim.json —
// the 6 files every fresh `trim init` produces regardless of
// ui.adapter/ui.shell, before any adapter/styling-specific extra (trim.css,
// trim/TrimShell.tsx, or an opted-into global-stylesheet edit).
const CORE_FILE_COUNT = 6;

const VANILLA_POPOVER_DEFAULT = {
  adapter: "vanilla",
  shell: "popover",
  styling: "default",
};

// Radix-flavored stub — mimics @radix-ui/react-popover/@radix-ui/react-slot's
// real composition contract (asChild merges the trigger's props onto its
// single child) closely enough to prove the generated <PopoverTrigger asChild>
// actually works, without a real @radix-ui dependency anywhere in this repo.
const SHADCN_STUB_SOURCE = {
  "switch.tsx": `import * as React from "react";
export function Switch(props: any) { return React.createElement("button", props); }
`,
  "toggle-group.tsx": `import * as React from "react";
export function ToggleGroup(props: any) { return React.createElement("div", null, props.children); }
export function ToggleGroupItem(props: any) { return React.createElement("button", null, props.children); }
`,
  "toggle.tsx": `import * as React from "react";
export function Toggle(props: any) { return React.createElement("button", props, props.children); }
`,
  "button.tsx": `import * as React from "react";
export function Button(props: { variant?: string; asChild?: boolean; children?: React.ReactNode }) {
  return React.createElement("button", null, props.children);
}
`,
  "popover.tsx": `import * as React from "react";
export function Popover(props: { children?: React.ReactNode }) { return React.createElement(React.Fragment, null, props.children); }
export function PopoverTrigger(props: { asChild?: boolean; children?: React.ReactNode }) { return React.createElement(React.Fragment, null, props.children); }
export function PopoverContent(props: { align?: string; children?: React.ReactNode }) { return React.createElement("div", null, props.children); }
`,
  "dialog.tsx": `import * as React from "react";
export function Dialog(props: { children?: React.ReactNode }) { return React.createElement(React.Fragment, null, props.children); }
export function DialogTrigger(props: { asChild?: boolean; children?: React.ReactNode }) { return React.createElement(React.Fragment, null, props.children); }
export function DialogContent(props: { children?: React.ReactNode }) { return React.createElement("div", null, props.children); }
`,
};

// Base UI-flavored stub — mimics @base-ui-components/react's real `render`
// prop contract (the trigger renders the ELEMENT passed via `render`, with
// its own children as that element's content — never a nested <button>, and
// never an `asChild` prop anywhere) closely enough to prove the generated
// <PopoverTrigger render={<Button .../>}> actually works, without a real
// @base-ui/react dependency anywhere in this repo. A real import specifier
// ("@base-ui/react/popover"/"@base-ui/react/dialog") is present in each file
// purely so the "style" key can be omitted in a fallback-detection test and
// still resolve to "base" via signal 2 (grepping installed imports).
const SHADCN_STUB_SOURCE_BASE = {
  "switch.tsx": SHADCN_STUB_SOURCE["switch.tsx"],
  "toggle-group.tsx": SHADCN_STUB_SOURCE["toggle-group.tsx"],
  "toggle.tsx": SHADCN_STUB_SOURCE["toggle.tsx"],
  "button.tsx": `import * as React from "react";
export function Button(props: { variant?: string; children?: React.ReactNode }) {
  return React.createElement("button", null, props.children);
}
`,
  "popover.tsx": `import * as React from "react";
// import type { PopoverTrigger as BaseUIPopoverTrigger } from "@base-ui/react/popover";
export function Popover(props: { children?: React.ReactNode }) { return React.createElement(React.Fragment, null, props.children); }
export function PopoverTrigger(props: { render?: React.ReactElement; children?: React.ReactNode }) {
  const { render, children, ...rest } = props;
  if (render && React.isValidElement(render)) return React.cloneElement(render, rest, children);
  return React.createElement("button", rest, children);
}
export function PopoverContent(props: { align?: string; children?: React.ReactNode }) { return React.createElement("div", null, props.children); }
`,
  "dialog.tsx": `import * as React from "react";
// import type { DialogTrigger as BaseUIDialogTrigger } from "@base-ui/react/dialog";
export function Dialog(props: { children?: React.ReactNode }) { return React.createElement(React.Fragment, null, props.children); }
export function DialogTrigger(props: { render?: React.ReactElement; children?: React.ReactNode }) {
  const { render, children, ...rest } = props;
  if (render && React.isValidElement(render)) return React.cloneElement(render, rest, children);
  return React.createElement("button", rest, children);
}
export function DialogContent(props: { children?: React.ReactNode }) { return React.createElement("div", null, props.children); }
`,
};

// Same Radix-flavored stub as SHADCN_STUB_SOURCE, plus an inert commented-out
// real Radix import — used ONLY to exercise signal 2's fallback grep when no
// "style" key is present; SHADCN_STUB_SOURCE itself stays import-hint-free so
// it can double as the "genuinely undetectable" fixture below.
const SHADCN_STUB_SOURCE_RADIX_HINT = {
  ...SHADCN_STUB_SOURCE,
  "popover.tsx": `import * as React from "react";
// import type { Popover as RadixPopover } from "@radix-ui/react-popover";
${SHADCN_STUB_SOURCE["popover.tsx"].split("\n").slice(1).join("\n")}`,
};

/**
 * A real shadcn setup: components.json + a matching tsconfig path alias +
 * real Button/Popover/Dialog stub files on disk — everything
 * buildShadcnShellPlan (cli/generators/shadcn-shell.ts) needs to succeed,
 * without relying on any shadcn actually installed on the developer's
 * machine. `style` defaults to a known legacy value ("new-york" -> radix,
 * signal 1) so every pre-existing Radix-flavored call site here stays
 * deterministic; pass `style: undefined` to instead exercise signal 2
 * (grepping the stub source's own imports), or a real backend-prefixed
 * value ("base-vega", "aria-lyra", or an unrecognized string) to exercise
 * the other branches — see ShadcnSetup.backend's own doc. `backend` selects
 * which stub source flavor gets written to disk: "radix" (default, no
 * import hints — also doubles as the "genuinely undetectable" fixture),
 * "radix-hint" (same composition, PLUS a commented real Radix import, for
 * signal-2 fallback tests), or "base" (Base UI's `render` composition, plus
 * a commented real Base UI import).
 */
function shadcnFixture(name, options = {}) {
  const {
    presentComponents = ["button.tsx", "popover.tsx", "dialog.tsx", "switch.tsx", "toggle-group.tsx", "toggle.tsx"],
    backend = "radix",
  } = options;
  // NOT a destructuring default (`style = 'new-york'`) — a default param
  // only applies when the property is OMITTED or `undefined`, and callers
  // here deliberately pass `style: undefined` to mean "no style key at
  // all" (to exercise signal 2), which a plain destructuring default would
  // silently overwrite back to 'new-york'. `in` distinguishes "omitted" (->
  // default) from "explicitly undefined" (-> really no style key).
  const style = "style" in options ? options.style : "new-york";
  const stubSource =
    backend === "base"
      ? SHADCN_STUB_SOURCE_BASE
      : backend === "radix-hint"
        ? SHADCN_STUB_SOURCE_RADIX_HINT
        : SHADCN_STUB_SOURCE;
  const componentsJson = { aliases: { ui: "@/components/ui" } };
  if (style !== undefined) componentsJson.style = style;
  const dir = fixture(name, {
    tsconfig: JSON.stringify({
      compilerOptions: {
        moduleResolution: "bundler",
        baseUrl: ".",
        paths: { "@/*": ["./*"] },
      },
    }),
    files: { "components.json": JSON.stringify(componentsJson) },
  });
  mkdirSync(path.join(dir, "components/ui"), { recursive: true });
  for (const file of presentComponents) {
    writeFileSync(
      path.join(dir, "components/ui", file),
      stubSource[file],
      "utf8",
    );
  }
  return dir;
}

/**
 * A scripted fake `Prompter` (cli/prompts/prompter.ts) — same queue-of-
 * answers idea as every CLI wizard test's scriptedAsk used to be, methods
 * resolve immediately, no TTY/stdin involved. `select()` answers are
 * 1-indexed, matching the on-screen choice order, same convention every
 * other CLI test file uses.
 */
function scriptedPrompter(answers) {
  const queue = [...answers];
  function pop(message) {
    if (queue.length === 0)
      throw new Error(
        `scriptedPrompter: ran out of answers (last prompt: ${JSON.stringify(message)})`,
      );
    return queue.shift();
  }
  return {
    async input(opts) {
      return pop(opts.message);
    },
    async select(opts) {
      const raw = pop(opts.message);
      const choice = opts.choices[Number(raw) - 1];
      if (!choice)
        throw new Error(
          `scriptedPrompter: select got out-of-range answer ${JSON.stringify(raw)} for "${opts.message}"`,
        );
      return choice.value;
    },
    async confirm(opts) {
      const raw = pop(opts.message);
      if (typeof raw === "boolean") return raw;
      if (raw === "") return opts.default ?? false;
      return raw === "y" || raw === "yes";
    },
    async checkbox(opts) {
      const indices = new Set(pop(opts.message));
      return opts.choices
        .filter((_, i) => indices.has(i + 1))
        .map((c) => c.value);
    },
  };
}

/**
 * A minimal, hand-built `ProjectInfo` (cli/project/detect-project.ts) —
 * collectInitAnswers does no filesystem I/O at all, and only
 * `shadcnConfigured`/`globalStylesheet` actually influence its branching,
 * so every other field is an arbitrary valid placeholder matching the real
 * type shape.
 */
function projectInfoFixture(shadcnConfigured, globalStylesheet = undefined) {
  return {
    cwd: "/nonexistent/does-not-matter",
    isTypeScript: true,
    tsconfigPath: undefined,
    moduleResolution: "classic-or-bundler",
    packageManager: "npm",
    shadcnConfigured,
    globalStylesheet,
    identifiedProjectTokens: [],
  };
}

/**
 * A recording fake `Prompter` for collectInitAnswers specifically: each
 * `select()` call is recorded (message + choices.map(c => c.value)) before
 * resolving to the next scripted answer — collectInitAnswers never calls
 * input()/confirm()/checkbox(), so those throw if it ever does.
 */
function recordingSelectPrompter(answers) {
  const queue = [...answers];
  const calls = [];
  return {
    calls,
    async select(opts) {
      calls.push({
        message: opts.message,
        choices: opts.choices.map((c) => c.value),
      });
      if (queue.length === 0)
        throw new Error(
          `recordingSelectPrompter: ran out of answers (last prompt: ${JSON.stringify(opts.message)})`,
        );
      return queue.shift();
    },
    async input(opts) {
      throw new Error(
        `recordingSelectPrompter: unexpected input() call for "${opts.message}" — collectInitAnswers only ever calls select()`,
      );
    },
    async confirm(opts) {
      throw new Error(
        `recordingSelectPrompter: unexpected confirm() call for "${opts.message}" — collectInitAnswers only ever calls select()`,
      );
    },
    async checkbox(opts) {
      throw new Error(
        `recordingSelectPrompter: unexpected checkbox() call for "${opts.message}" — collectInitAnswers only ever calls select()`,
      );
    },
  };
}

try {
  // --- stripJsonComments: the one thing worth unit-testing in isolation ---
  // --- (real-world tsconfig.json footgun: a "//" inside a URL value) ---
  {
    const source =
      '{\n  "$schema": "https://json.schemastore.org/tsconfig",\n  // a real comment\n  "compilerOptions": { "moduleResolution": "bundler", },\n}';
    const stripped = JSON.parse(stripJsonComments(source));
    assert.equal(
      stripped.$schema,
      "https://json.schemastore.org/tsconfig",
      'a "//" inside a string value must survive comment stripping',
    );
    assert.equal(stripped.compilerOptions.moduleResolution, "bundler");
  }

  // --- relativeImportSpecifier: the generation-time module-resolution helper ---
  {
    assert.equal(
      relativeImportSpecifier("classic-or-bundler", "./trim/trim.config"),
      "./trim/trim.config",
    );
    assert.equal(
      relativeImportSpecifier("node16-or-nodenext", "./trim/trim.config"),
      "./trim/trim.config.js",
    );
  }

  // --- trim.json: serialize/parse round trip, and rejection of malformed content ---
  {
    const metadata = { version: 1, shadcn: true, styling: "tokens" };
    assert.deepEqual(
      parseTrimMetadata(serializeTrimMetadata(metadata)),
      metadata,
    );
    assert.equal(parseTrimMetadata("not json"), undefined);
    assert.equal(
      parseTrimMetadata('{"version":2,"shadcn":false,"styling":"default"}'),
      undefined,
      "an unknown version is not guessed at",
    );
    assert.equal(
      parseTrimMetadata('{"version":1,"shadcn":false,"styling":"nonsense"}'),
      undefined,
      "an unrecognized styling value is not guessed at",
    );
    // the new optional `ui` block: round-trips when present and well-shaped, rejected when present but malformed, absent is still fine (an older trim.json)
    const withUi = {
      version: 1,
      shadcn: true,
      styling: "headless",
      ui: { adapter: "shadcn", shell: "dialog" },
    };
    assert.deepEqual(parseTrimMetadata(serializeTrimMetadata(withUi)), withUi);
    const withHeadlessUi = {
      version: 1,
      shadcn: false,
      styling: "headless",
      ui: { adapter: "headless" },
    };
    assert.deepEqual(
      parseTrimMetadata(serializeTrimMetadata(withHeadlessUi)),
      withHeadlessUi,
    );
    assert.equal(
      parseTrimMetadata(
        '{"version":1,"shadcn":false,"styling":"default","ui":{"adapter":"bogus"}}',
      ),
      undefined,
      "an unrecognized ui.adapter is not guessed at",
    );
    assert.equal(
      parseTrimMetadata(
        '{"version":1,"shadcn":false,"styling":"default","ui":{"adapter":"vanilla","shell":"bogus"}}',
      ),
      undefined,
      "an unrecognized ui.shell is not guessed at",
    );
  }

  // --- fresh TypeScript project: detection ---
  {
    const dir = fixture("fresh-ts", {
      tsconfig: '{ "compilerOptions": { "moduleResolution": "bundler" } }',
    });
    const project = detectProject(dir);
    assert.equal(project.isTypeScript, true);
    assert.equal(project.moduleResolution, "classic-or-bundler");
    assert.equal(project.shadcnConfigured, false);
    assert.equal(project.globalStylesheet, undefined);
    assert.deepEqual(project.identifiedProjectTokens, []);
  }

  // --- JS-only project: no tsconfig.json at all ---
  {
    const dir = fixture("js-only", { tsconfig: null });
    const project = detectProject(dir);
    assert.equal(project.isTypeScript, false);
  }

  // --- moduleResolution differences drive the printed integration snippet ---
  {
    const bundlerDir = fixture("resolution-bundler", {
      tsconfig: '{ "compilerOptions": { "moduleResolution": "bundler" } }',
    });
    const nodenextDir = fixture("resolution-nodenext", {
      tsconfig: '{ "compilerOptions": { "moduleResolution": "nodenext" } }',
    });
    const bundlerPlan = await buildInitPlan(
      detectProject(bundlerDir),
      VANILLA_POPOVER_DEFAULT,
    );
    const nodenextPlan = await buildInitPlan(
      detectProject(nodenextDir),
      VANILLA_POPOVER_DEFAULT,
    );
    assert.equal(
      bundlerPlan.integrationSnippet,
      'import { TrimPanel } from "./trim/TrimPanel";\n\n<TrimPanel />',
      "bundler resolution: extensionless, concise <TrimPanel/> mount instruction",
    );
    assert.equal(
      nodenextPlan.integrationSnippet,
      'import { TrimPanel } from "./trim/TrimPanel.js";\n\n<TrimPanel />',
      "nodenext resolution: explicit .js",
    );
  }

  // --- generated file contents: exact, for each adapter, and the seeded starter control ---
  {
    const vanillaPopover = generateConfigContents({
      adapter: "vanilla",
      shell: "popover",
    });
    assert.equal(
      vanillaPopover,
      generateConfigContents({ adapter: "vanilla", shell: "popover" }),
      "deterministic",
    );
    assert.match(
      vanillaPopover,
      /defineTrimConfig\(\{\s*\n\s*ui: \{\s*\n\s*adapter: "vanilla",\s*\n\s*shell: "popover",\s*\n\s*\},\s*\n\s*layout: "sections",/,
    );
    assert.match(
      vanillaPopover,
      /groups: \[\s*\n\s*\{\s*\n\s*id: "starter",\s*\n\s*label: "Example",\s*\n\s*controls: \["starter"\],\s*\n\s*\},\s*\n\s*\],/,
    );

    const headless = generateConfigContents({ adapter: "headless" });
    assert.match(
      headless,
      /ui: \{\s*\n\s*adapter: "headless",\s*\n\s*\},\s*\n\s*layout: "sections",/,
    );
    assert.doesNotMatch(
      headless,
      /shell:/,
      "headless never generates a shell key at all — no shell concept applies",
    );

    const shadcnDialog = generateConfigContents({
      adapter: "shadcn",
      shell: "dialog",
    });
    assert.match(
      shadcnDialog,
      /ui: \{\s*\n\s*adapter: "shadcn",\s*\n\s*shell: "dialog",\s*\n\s*\},/,
    );

    assert.match(
      generateManifestContents("classic-or-bundler"),
      /import starter from "\.\/controls\/starter\.trim";\n\nexport const trimControls = \[\n {2}starter,\n\] as const;/,
    );
    assert.match(
      generateManifestContents("node16-or-nodenext"),
      /from "\.\/controls\/starter\.trim\.js";/,
      "node16/nodenext: the seeded control import carries the compiled .js extension",
    );

    const settingsCode = generateSettingsContents().replace(/\/\/[^\n]*/g, ""); // strip comments — they legitimately *name* createTrimController to explain the (now real) schema
    assert.match(
      settingsCode,
      /createTrimController\(/,
      "a real settings schema now exists — the seeded starter control genuinely needs one",
    );
    assert.match(
      generateSettingsContents(),
      /@trim-managed-schema \{"version":1,"settings":\[\{"key":"starter","kind":"boolean","defaultValue":false\}\]\}/,
    );
    assert.match(
      generateSettingsContents(),
      /export const trimSettings = \{\n {2}starter: callback<boolean>\(/,
    );

    const starterControl = generateStarterControlContents("classic-or-bundler");
    assert.match(
      starterControl,
      /import \{ defineBooleanControl \} from "@theharborproject\/trim";/,
    );
    assert.match(
      starterControl,
      /import \{ trimSettings \} from "\.\.\/trim\.settings";/,
    );
    assert.match(starterControl, /id: "starter",/);
    assert.match(starterControl, /label: "Starter control",/);
    assert.match(starterControl, /binding: trimSettings\.starter,/);
    assert.match(
      generateStarterControlContents("node16-or-nodenext"),
      /from "\.\.\/trim\.settings\.js";/,
    );
    assert.equal(STARTER_CONTROL_PATH, "trim/controls/starter.trim.ts");
  }

  // --- generateTrimPanelContents: exact shape for every adapter, the one mount component `trim init` always generates ---
  {
    assert.equal(TRIM_PANEL_PATH, "trim/TrimPanel.tsx");

    // vanilla: independent component, wraps <Trim.Registry><Trim.Panel/></Trim.Registry> directly.
    const vanilla = generateTrimPanelContents(
      { adapter: "vanilla", shell: "popover" },
      "classic-or-bundler",
    );
    assert.equal(
      vanilla,
      `"use client";

// Generated by Trim (\`trim init\`). Mount <TrimPanel/> wherever the panel
// should be reachable from — this file already carries its own
// "use client", so it can be rendered directly from a Server Component
// (e.g. a Next.js RootLayout) with no extra client-boundary work needed.
// Host-owned from here on — trim init only (re)writes this file when its
// content doesn't already match, exactly like every other generated file.
import { Trim } from "@theharborproject/trim/react";
import trimConfig from "./trim.config";
import { trimControls } from "./trim.manifest";

export function TrimPanel() {
  return (
    <Trim.Registry controls={trimControls}>
      <Trim.Panel config={trimConfig} />
    </Trim.Registry>
  );
}
`,
    );
    assert.equal(
      vanilla,
      generateTrimPanelContents(
        { adapter: "vanilla", shell: "popover" },
        "classic-or-bundler",
      ),
      "deterministic",
    );
    assert.match(
      generateTrimPanelContents(
        { adapter: "vanilla", shell: "inline" },
        "node16-or-nodenext",
      ),
      /import trimConfig from "\.\/trim\.config\.js";\nimport \{ trimControls \} from "\.\/trim\.manifest\.js";/,
      "node16/nodenext: both sibling imports carry the compiled .js extension",
    );

    // headless: same independent-component shape as vanilla — no shell concept, but still needs somewhere to register trimControls and render <Trim.Panel>.
    const headless = generateTrimPanelContents(
      { adapter: "headless" },
      "classic-or-bundler",
    );
    assert.match(headless, /import trimConfig from "\.\/trim\.config";/);
    assert.match(headless, /<Trim\.Panel config={trimConfig} \/>/);
    assert.doesNotMatch(headless, /TrimShell/);

    // shadcn + inline: no TrimShell.tsx is ever generated for "inline" — same independent-component shape.
    const shadcnInline = generateTrimPanelContents(
      { adapter: "shadcn", shell: "inline" },
      "classic-or-bundler",
    );
    assert.match(shadcnInline, /<Trim\.Panel config={trimConfig} \/>/);
    assert.doesNotMatch(shadcnInline, /TrimShell/);

    // shadcn + popover/dialog: TrimShell.tsx already exists and renders ONLY <Panel> (see cli/templates/shadcn/shell/*.tsx) —
    // it does not register trimControls, so TrimPanel must be the one providing <Trim.Registry> around it.
    const shadcnPopover = generateTrimPanelContents(
      { adapter: "shadcn", shell: "popover" },
      "classic-or-bundler",
    );
    assert.equal(
      shadcnPopover,
      `"use client";

// Generated by Trim (\`trim init\`). Mount <TrimPanel/> wherever the panel
// should be reachable from — this file already carries its own
// "use client", so it can be rendered directly from a Server Component
// (e.g. a Next.js RootLayout) with no extra client-boundary work needed.
// Wraps the generated <TrimShell/> (trim/TrimShell.tsx) in <Trim.Registry>:
// TrimShell only renders <Panel>, it does not register trimControls itself.
// Host-owned from here on — trim init only (re)writes this file when its
// content doesn't already match, exactly like every other generated file.
import { Trim } from "@theharborproject/trim/react";
import { trimControls } from "./trim.manifest";
import { TrimShell } from "./TrimShell";

export function TrimPanel() {
  return (
    <Trim.Registry controls={trimControls}>
      <TrimShell />
    </Trim.Registry>
  );
}
`,
    );
    assert.doesNotMatch(
      shadcnPopover,
      /trimConfig/,
      "the shell-wrapping shape never imports trim.config itself — TrimShell already does",
    );

    const shadcnDialog = generateTrimPanelContents(
      { adapter: "shadcn", shell: "dialog" },
      "classic-or-bundler",
    );
    assert.match(shadcnDialog, /<TrimShell \/>/);
    assert.match(
      generateTrimPanelContents(
        { adapter: "shadcn", shell: "popover" },
        "node16-or-nodenext",
      ),
      /import \{ trimControls \} from "\.\/trim\.manifest\.js";\nimport \{ TrimShell \} from "\.\/TrimShell\.js";/,
      "node16/nodenext: both sibling imports carry the compiled .js extension",
    );
  }

  // --- collectInitAnswers: the reconciled prompt flow's branching (cli/prompts/init-prompts.ts) ---
  // --- driven directly through a recording fake Prompter, no plan-building/filesystem involved ---
  {
    // A: shadcnConfigured true -> the adapter select's choices include 'shadcn' (first, exact order).
    {
      const prompter = recordingSelectPrompter([
        "vanilla",
        "popover",
        "default",
      ]);
      await collectInitAnswers(projectInfoFixture(true), prompter);
      assert.deepEqual(
        prompter.calls[0].choices,
        ["shadcn", "vanilla", "headless"],
        "shadcn offered first when shadcnConfigured",
      );
      assert.equal(prompter.calls[0].message, "UI integration:");
    }

    // B: shadcnConfigured false -> the adapter select's choices do NOT include 'shadcn'.
    {
      const prompter = recordingSelectPrompter([
        "vanilla",
        "popover",
        "default",
      ]);
      await swallowLogs(() =>
        collectInitAnswers(projectInfoFixture(false), prompter),
      );
      assert.deepEqual(
        prompter.calls[0].choices,
        ["vanilla", "headless"],
        "no shadcn choice at all when shadcn is not configured",
      );
    }

    // C: adapter answer = headless -> shell select is never called, styling select is never called.
    {
      const prompter = recordingSelectPrompter(["headless"]);
      let answers;
      await swallowLogs(async () => {
        answers = await collectInitAnswers(projectInfoFixture(false), prompter);
      });
      assert.equal(
        prompter.calls.length,
        1,
        "only the adapter select runs for headless",
      );
      assert.equal(answers.adapter, "headless");
      assert.equal(answers.shell, undefined);
      assert.equal(answers.styling, undefined);
    }

    // D: adapter answer = shadcn -> shell select IS called, styling select is NOT called.
    {
      const prompter = recordingSelectPrompter(["shadcn", "dialog"]);
      const answers = await collectInitAnswers(
        projectInfoFixture(true),
        prompter,
      );
      assert.equal(
        prompter.calls.length,
        2,
        "adapter + shell, no styling question for shadcn",
      );
      assert.deepEqual(prompter.calls[1].choices, [
        "popover",
        "dialog",
        "inline",
      ]);
      assert.equal(prompter.calls[1].message, "Panel shell:");
      assert.equal(answers.adapter, "shadcn");
      assert.equal(answers.shell, "dialog");
      assert.equal(answers.styling, undefined);
    }

    // E: adapter answer = vanilla -> shell select IS called AND styling select IS called.
    {
      const prompter = recordingSelectPrompter(["vanilla", "inline", "tokens"]);
      let answers;
      await swallowLogs(async () => {
        answers = await collectInitAnswers(projectInfoFixture(false), prompter);
      });
      assert.equal(
        prompter.calls.length,
        3,
        "adapter + shell + styling, all three asked for vanilla",
      );
      assert.deepEqual(prompter.calls[2].choices, ["default", "tokens"]);
      assert.equal(prompter.calls[2].message, "How should Trim be styled?");
      assert.equal(answers.adapter, "vanilla");
      assert.equal(answers.shell, "inline");
      assert.equal(answers.styling, "tokens");
    }

    // F: adapter answer = vanilla + a detected global stylesheet -> the "Add Trim theme import?" select IS called, Yes/No in that order, default Yes.
    {
      const prompter = recordingSelectPrompter([
        "vanilla",
        "popover",
        "default",
        true,
      ]);
      let answers;
      await swallowLogs(async () => {
        answers = await collectInitAnswers(
          projectInfoFixture(false, "src/app/globals.css"),
          prompter,
        );
      });
      assert.equal(
        prompter.calls.length,
        4,
        "adapter + shell + styling + the new stylesheet-import question, for vanilla with a detected stylesheet",
      );
      assert.equal(
        prompter.calls[3].message,
        "Add Trim theme import to src/app/globals.css?",
      );
      assert.deepEqual(prompter.calls[3].choices, [true, false]);
      assert.equal(answers.importStylesheet, true);
    }

    // G: adapter answer = vanilla but NO global stylesheet detected -> the stylesheet-import question is never asked.
    {
      const prompter = recordingSelectPrompter([
        "vanilla",
        "popover",
        "default",
      ]);
      let answers;
      await swallowLogs(async () => {
        answers = await collectInitAnswers(
          projectInfoFixture(false, undefined),
          prompter,
        );
      });
      assert.equal(
        prompter.calls.length,
        3,
        "no stylesheet-import question when no safe stylesheet was detected",
      );
      assert.equal(answers.importStylesheet, undefined);
    }

    // H: adapter answer = headless, even WITH a detected stylesheet -> the stylesheet-import question is never asked (headless needs no Trim CSS at all).
    {
      const prompter = recordingSelectPrompter(["headless"]);
      let answers;
      await swallowLogs(async () => {
        answers = await collectInitAnswers(
          projectInfoFixture(false, "src/app/globals.css"),
          prompter,
        );
      });
      assert.equal(
        prompter.calls.length,
        1,
        "headless: only the adapter select runs, even with a detected stylesheet",
      );
      assert.equal(answers.importStylesheet, undefined);
    }

    // I: adapter answer = shadcn, even WITH a detected stylesheet -> the stylesheet-import question is never asked (shadcn inherits the host's own design system).
    {
      const prompter = recordingSelectPrompter(["shadcn", "popover"]);
      const answers = await collectInitAnswers(
        projectInfoFixture(true, "src/app/globals.css"),
        prompter,
      );
      assert.equal(
        prompter.calls.length,
        2,
        "shadcn: adapter + shell only, even with a detected stylesheet",
      );
      assert.equal(answers.importStylesheet, undefined);
    }

    // J: answering "No" to the stylesheet-import question is recorded as false, distinct from "never asked" (undefined).
    {
      const prompter = recordingSelectPrompter([
        "vanilla",
        "popover",
        "default",
        false,
      ]);
      let answers;
      await swallowLogs(async () => {
        answers = await collectInitAnswers(
          projectInfoFixture(false, "src/app/globals.css"),
          prompter,
        );
      });
      assert.equal(
        answers.importStylesheet,
        false,
        '"No" is recorded as false, not left undefined',
      );
    }
  }

  // --- styling: default theme (vanilla adapter) -> no extra file (still exactly the 5 core files), correct instruction ---
  {
    const dir = fixture("styling-default", { tsconfig: "{}" });
    const plan = await buildInitPlan(
      detectProject(dir),
      VANILLA_POPOVER_DEFAULT,
    );
    assert.equal(
      plan.files.length,
      CORE_FILE_COUNT,
      "no trim.css for the default-theme choice",
    );
    assert.ok(
      plan.notes.some((n) =>
        n.includes("@theharborproject/trim/themes/base.css"),
      ),
    );

    assert.ok(
      plan.notes.some((n) =>
        n.includes("@theharborproject/trim/themes/controls.css"),
      ),
    );

    assert.ok(
      plan.notes.some((n) =>
        n.includes("@theharborproject/trim/themes/shell.css"),
      ),
    );
    const trimJson = plan.files.find((f) => f.path === TRIM_JSON_PATH);
    const metadata = parseTrimMetadata(trimJson.contents);
    assert.deepEqual(metadata, {
      version: 1,
      shadcn: false,
      styling: "default",
      ui: { adapter: "vanilla", shell: "popover" },
    });
  }

  // --- adapter: headless -> no extra file, no CSS import mentioned, no shell prompt/field at all ---
  {
    const dir = fixture("adapter-headless", { tsconfig: "{}" });
    const plan = await buildInitPlan(detectProject(dir), {
      adapter: "headless",
    });
    assert.equal(plan.files.length, CORE_FILE_COUNT);
    assert.ok(
      plan.notes.some((n) => n.includes("headless") || n.includes("yourself")),
    );
    assert.ok(
      !plan.notes.some((n) => n.includes("@theharborproject/trim/themes/")),
      "headless never mentions importing Trim CSS",
    );
    const metadata = parseTrimMetadata(
      plan.files.find((f) => f.path === TRIM_JSON_PATH).contents,
    );
    assert.equal(metadata.styling, "headless");
    assert.deepEqual(
      metadata.ui,
      { adapter: "headless" },
      "no shell key recorded for headless",
    );
    const config = plan.files.find((f) => f.path === CONFIG_PATH).contents;
    assert.doesNotMatch(config, /shell:/);
  }

  // --- styling: project tokens, WITH identifiable tokens (vanilla adapter only) ---
  {
    const dir = fixture("styling-tokens-found", {
      tsconfig: "{}",
      files: {
        "src/index.css":
          ":root { --background: #fff; --foreground: #111; --border: #eee; --something-else: red; }",
      },
    });
    const project = detectProject(dir);
    assert.deepEqual(project.identifiedProjectTokens.sort(), [
      "background",
      "border",
      "foreground",
    ]);
    const plan = await buildInitPlan(project, {
      adapter: "vanilla",
      shell: "popover",
      styling: "tokens",
    });
    assert.equal(
      plan.files.length,
      CORE_FILE_COUNT + 1,
      "trim.css is the one extra file for the tokens choice",
    );
    const cssFile = plan.files.find((f) => f.path === TOKENS_CSS_PATH);
    assert.ok(cssFile, "trim/trim.css is planned");
    assert.match(cssFile.contents, /--trim-bg: var\(--background\);/);
    assert.match(cssFile.contents, /--trim-ink: var\(--foreground\);/);
    assert.match(cssFile.contents, /--trim-line: var\(--border\);/);
    assert.doesNotMatch(
      cssFile.contents,
      /--something-else/,
      "an unrecognized project variable is never guessed into the mapping",
    );
    assert.ok(plan.notes.some((n) => n.includes("Mapped 3 token")));
    assert.deepEqual(
      parseTrimMetadata(
        plan.files.find((f) => f.path === TRIM_JSON_PATH).contents,
      ).styling,
      "tokens",
    );
  }

  // --- styling: project tokens, with NO identifiable tokens -> standalone fallback, never invented names ---
  {
    const dir = fixture("styling-tokens-not-found", { tsconfig: "{}" });
    const plan = await buildInitPlan(detectProject(dir), {
      adapter: "vanilla",
      shell: "popover",
      styling: "tokens",
    });
    const cssFile = plan.files.find((f) => f.path === TOKENS_CSS_PATH);
    assert.ok(cssFile);
    const cssCode = cssFile.contents.replace(/\/\*[\s\S]*?\*\//g, ""); // strip the comment — it legitimately shows var(--your-background-token) as an illustrative example
    assert.doesNotMatch(
      cssCode,
      /var\(--/,
      "no var(--...) reference to a nonexistent project variable outside the illustrative comment",
    );
    assert.match(cssFile.contents, /standalone starter values/);
    assert.ok(
      plan.notes.some((n) =>
        n.includes("No recognizable project design tokens"),
      ),
    );
  }
  {
    // generateTokensCssContents in isolation, both branches
    assert.equal(
      generateTokensCssContents(["background"]).usedIdentifiedTokens,
      true,
    );
    assert.equal(generateTokensCssContents([]).usedIdentifiedTokens, false);
  }

// --- stylesheet-import edit: opted in (default styling) -> the detected global stylesheet is planned as "update",
// exact required imports appended, applied, idempotent on rerun ---
{
  const dir = fixture("stylesheet-import-default", {
    tsconfig: "{}",
    files: { "src/index.css": "body { margin: 0; }\n" },
  });

  const project = detectProject(dir);

  assert.equal(project.globalStylesheet, "src/index.css");

  const plan = await buildInitPlan(project, {
    adapter: "vanilla",
    shell: "popover",
    styling: "default",
    importStylesheet: true,
  });

  const cssEntry = plan.files.find(
    (f) => f.path === "src/index.css",
  );

  assert.ok(
    cssEntry,
    "the detected global stylesheet is included in the plan",
  );

  assert.equal(cssEntry.status, "update");

  const expectedCss = [
    "body { margin: 0; }",
    '@import "@theharborproject/trim/themes/base.css";',
    '@import "@theharborproject/trim/themes/controls.css";',
    '@import "@theharborproject/trim/themes/shell.css";',
    "",
  ].join("\n");

  assert.equal(
    cssEntry.contents,
    expectedCss,
  );

  assert.ok(
    !plan.notes.some((n) => n.includes("did not edit it")),
    'the manual "did not edit it" instruction is not printed once an automatic edit happens',
  );

  assert.ok(
    plan.notes.some((n) =>
      n.includes(
        "Added 3 missing Trim theme import(s) to src/index.css",
      ),
    ),
  );

  await applyInitPlan(dir, plan);

  assert.equal(
    readFileSync(path.join(dir, "src/index.css"), "utf8"),
    expectedCss,
  );

  // Idempotent: re-running with the same answers against the now-edited
  // file reports "matches", not another append.
  const secondPlan = await buildInitPlan(project, {
    adapter: "vanilla",
    shell: "popover",
    styling: "default",
    importStylesheet: true,
  });

  const secondCssEntry = secondPlan.files.find(
    (f) => f.path === "src/index.css",
  );

  assert.equal(secondCssEntry.status, "matches");

  assert.equal(
    secondCssEntry.contents,
    expectedCss,
    "unchanged — no duplicate Trim theme imports",
  );

  await applyInitPlan(dir, secondPlan);

  const afterRerun = readFileSync(
    path.join(dir, "src/index.css"),
    "utf8",
  );

  for (const theme of ["base", "controls", "shell"]) {
    assert.equal(
      (
        afterRerun.match(
          new RegExp(
            `@import "@theharborproject/trim/themes/${theme}\\.css";`,
            "g",
          ),
        ) || []
      ).length,
      1,
      `${theme}.css import was never duplicated`,
    );
  }
}

// --- stylesheet-import edit: opted in with "tokens" styling ->
// theme layers + trim.css appended, trim.css referenced via a real
// relative path from the stylesheet's own directory ---
{
  const dir = fixture("stylesheet-import-tokens", {
    tsconfig: "{}",
    files: {
      "src/app/globals.css":
        ":root { --background: #fff; }\n",
    },
  });

  const project = detectProject(dir);

  assert.equal(
    project.globalStylesheet,
    "src/app/globals.css",
  );

  const plan = await buildInitPlan(project, {
    adapter: "vanilla",
    shell: "popover",
    styling: "tokens",
    importStylesheet: true,
  });

  const cssEntry = plan.files.find(
    (f) => f.path === "src/app/globals.css",
  );

  assert.equal(cssEntry.status, "update");

  const expectedCss = [
    ":root { --background: #fff; }",
    '@import "@theharborproject/trim/themes/base.css";',
    '@import "@theharborproject/trim/themes/controls.css";',
    '@import "@theharborproject/trim/themes/shell.css";',
    '@import "../../trim/trim.css";',
    "",
  ].join("\n");

  assert.equal(
    cssEntry.contents,
    expectedCss,
    "Trim theme layers load before trim.css so token overrides win the cascade",
  );

  await applyInitPlan(dir, plan);

  assert.equal(
    readFileSync(
      path.join(dir, "src/app/globals.css"),
      "utf8",
    ),
    expectedCss,
  );
}

  // --- stylesheet-import edit: declined ("No") -> the stylesheet is left completely untouched, manual instruction still printed ---
  {
    const dir = fixture("stylesheet-import-declined", {
      tsconfig: "{}",
      files: { "src/index.css": "body { margin: 0; }\n" },
    });
    const project = detectProject(dir);
    const plan = await buildInitPlan(project, {
      adapter: "vanilla",
      shell: "popover",
      styling: "default",
      importStylesheet: false,
    });
    assert.ok(
      !plan.files.some((f) => f.path === "src/index.css"),
      "declining leaves the stylesheet out of the plan entirely — nothing to write, nothing to conflict on",
    );
    assert.ok(
      plan.notes.some((n) => n.includes("did not edit it")),
      "the manual instruction is printed, same as before this question existed",
    );
    await applyInitPlan(dir, plan);
    assert.equal(
      readFileSync(path.join(dir, "src/index.css"), "utf8"),
      "body { margin: 0; }\n",
      "byte-for-byte untouched",
    );
  }

  // --- stylesheet-import edit: no safe stylesheet detected -> never asked, never edited, same manual instruction as before this feature existed ---
  {
    const dir = fixture("stylesheet-import-none-detected", { tsconfig: "{}" });
    const project = detectProject(dir);
    assert.equal(project.globalStylesheet, undefined);
    // importStylesheet: true here simulates a caller that (incorrectly) set it without a real stylesheet —
    // buildInitPlan's own defense-in-depth check (project.globalStylesheet !== undefined) must still hold.
    const plan = await buildInitPlan(project, {
      adapter: "vanilla",
      shell: "popover",
      styling: "default",
      importStylesheet: true,
    });
    assert.equal(
      plan.files.length,
      CORE_FILE_COUNT,
      "no stylesheet file entry at all — there is nothing safe to edit",
    );
    assert.ok(
      plan.notes.some((n) =>
        n.includes("Add this to wherever your project loads global styles"),
      ),
    );
  }

  // --- stylesheet-import edit: TRANSACTIONAL — a genuine conflict elsewhere in the plan blocks the stylesheet edit too, nothing is written ---
  {
    const dir = fixture("stylesheet-import-transactional", {
      tsconfig: "{}",
      files: { "src/index.css": "body { margin: 0; }\n" },
    });
    mkdirSync(path.join(dir, "trim"), { recursive: true });
    writeFileSync(
      path.join(dir, CONFIG_PATH),
      "// not what Trim would generate\n",
      "utf8",
    );

    const plan = await buildInitPlan(detectProject(dir), {
      adapter: "vanilla",
      shell: "popover",
      styling: "default",
      importStylesheet: true,
    });
    assert.equal(
      plan.files.find((f) => f.path === CONFIG_PATH).status,
      "conflict",
    );
    assert.equal(
      plan.files.find((f) => f.path === "src/index.css").status,
      "update",
      "the stylesheet edit itself is still individually safe...",
    );
    const hasConflict = plan.files.some((f) => f.status === "conflict");
    assert.ok(hasConflict);
    if (!hasConflict) await applyInitPlan(dir, plan); // mirrors runInitCommand's own conflict gate — see the other TRANSACTIONAL test above
    assert.equal(
      readFileSync(path.join(dir, "src/index.css"), "utf8"),
      "body { margin: 0; }\n",
      "...but the whole plan aborts, so it is never actually applied",
    );
  }

  // --- shadcn: chosen but not configured -> falls back to vanilla, trim.json NEVER records adapter "shadcn", clear caveat, no shadcn-referencing file generated ---
  {
    const dir = fixture("shadcn-not-configured", { tsconfig: "{}" });
    const plan = await buildInitPlan(detectProject(dir), {
      adapter: "shadcn",
      shell: "popover",
    });
    assert.ok(
      plan.notes.some((n) => n.includes("does not appear to be set up")),
    );
    assert.equal(
      plan.files.length,
      CORE_FILE_COUNT,
      "no trim/TrimShell.tsx is generated — the adapter fell back to vanilla",
    );
    assert.ok(
      !plan.files.some(
        (f) => f.path !== TRIM_JSON_PATH && /shadcn/i.test(f.contents),
      ),
      "no generated code file references shadcn once the adapter has fallen back",
    );
    const metadata = parseTrimMetadata(
      plan.files.find((f) => f.path === TRIM_JSON_PATH).contents,
    );
    assert.equal(
      metadata.shadcn,
      false,
      "trim.json never records shadcn:true unless shadcn is independently confirmed configured — defense in depth even when a caller bypasses the prompt-level guard",
    );
    assert.equal(
      metadata.ui.adapter,
      "vanilla",
      'trim.json never records ui.adapter: "shadcn" unless shadcn is independently confirmed configured either',
    );
  }

  // --- shadcn: chosen AND configured (with the required Button+Popover primitives on disk) -> TrimShell.tsx generated, trim.json records it ---
  {
    const dir = shadcnFixture("shadcn-configured");
    const project = detectProject(dir);
    assert.equal(project.shadcnConfigured, true);
    const plan = await buildInitPlan(project, {
      adapter: "shadcn",
      shell: "popover",
    });
    assert.ok(plan.notes.some((n) => n.includes("recorded in trim/trim.json")));
    assert.ok(
      !plan.notes.some((n) => n.includes("does not appear to be set up")),
    );
    assert.equal(
      plan.files.length,
      CORE_FILE_COUNT + 5,
      "trim/TrimShell.tsx plus the renderer map and three kind renderers are generated for a visible shadcn shell",
    );
    const metadata = parseTrimMetadata(
      plan.files.find((f) => f.path === TRIM_JSON_PATH).contents,
    );
    assert.equal(metadata.shadcn, true);
    assert.deepEqual(metadata.ui, { adapter: "shadcn", shell: "popover" });
    assert.ok(plan.notes.some((n) => n.includes("trim add @shadcn/controls/")));

    const shell = plan.files.find((f) => f.path === SHELL_PATH);

    assert.ok(shell, "trim/TrimShell.tsx is planned");
    assert.ok(plan.files.some((f) => f.path === "trim/trim.renderers.tsx"));
    assert.ok(plan.files.some((f) => f.path === "trim/renderers/shadcn-segmented.tsx"));
    
    assert.equal(shell.status, "create");
    
    assert.match(shell.contents, /"use client";/);
    
    assert.match(
      shell.contents,
      /import \{ Button \} from "@\/components\/ui\/button";/,
    );
    
    assert.match(
      shell.contents,
      /import\s*\{\s*Popover,\s*PopoverContent,\s*PopoverTrigger,\s*\}\s*from\s*"@\/components\/ui\/popover";/,
    );
    
    assert.match(
      shell.contents,
      /import \{ Panel \} from "@theharborproject\/trim\/react";/,
    );
    assert.match(shell.contents, /import trimConfig from "\.\/trim\.config";/);
    assert.match(shell.contents, /export function TrimShell\(\)/);
  }

  // --- shadcn: declined -> no note either way, trim.json records adapter "vanilla" ---
  {
    const dir = fixture("shadcn-declined", { tsconfig: "{}" });
    const plan = await buildInitPlan(
      detectProject(dir),
      VANILLA_POPOVER_DEFAULT,
    );
    assert.ok(!plan.notes.some((n) => n.toLowerCase().includes("shadcn")));
    const metadata = parseTrimMetadata(
      plan.files.find((f) => f.path === TRIM_JSON_PATH).contents,
    );
    assert.equal(metadata.shadcn, false);
    assert.equal(metadata.ui.adapter, "vanilla");
  }

  // --- shadcn shell: dialog variant generates the Dialog-flavored wrapper ---
  {
    const dir = shadcnFixture("shadcn-dialog");
    const plan = await buildInitPlan(detectProject(dir), {
      adapter: "shadcn",
      shell: "dialog",
    });
    const shell = plan.files.find((f) => f.path === SHELL_PATH);
    assert.match(
      shell.contents,
      /import \{ Dialog, DialogContent, DialogTrigger \} from "@\/components\/ui\/dialog";/,
    );
    assert.match(shell.contents, /export function TrimShell\(\)/);
  }

  // --- shadcn shell: "inline" needs no shell wrapper file at all, but adapter
  // initialization still provisions every supported renderer kind. ---
  {
    // Shell primitives are unnecessary for inline, but renderer primitives are
    // required because the adapter map is generated eagerly and completely.
    const dir = fixture("shadcn-inline-no-primitives", {
      tsconfig: JSON.stringify({
        compilerOptions: {
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@/*": ["./*"] },
        },
      }),
      files: {
        "components.json": JSON.stringify({
          aliases: { ui: "@/components/ui" },
        }),
        "components/ui/switch.tsx": SHADCN_STUB_SOURCE["switch.tsx"],
        "components/ui/toggle-group.tsx": SHADCN_STUB_SOURCE["toggle-group.tsx"],
        "components/ui/toggle.tsx": SHADCN_STUB_SOURCE["toggle.tsx"],
      },
    });
    const plan = await buildInitPlan(detectProject(dir), {
      adapter: "shadcn",
      shell: "inline",
    });
    assert.equal(
      plan.files.length,
      CORE_FILE_COUNT + 4,
      'no trim/TrimShell.tsx for shell: "inline"',
    );
    assert.ok(!plan.files.some((f) => f.path === SHELL_PATH));
    assert.ok(plan.files.some((f) => f.path === "trim/trim.renderers.tsx"));
    const metadata = parseTrimMetadata(
      plan.files.find((f) => f.path === TRIM_JSON_PATH).contents,
    );
    assert.deepEqual(
      metadata.ui,
      { adapter: "shadcn", shell: "inline" },
      "ui.shell is still recorded accurately even though no chrome is generated for it",
    );
    assert.ok(
      plan.notes.some((n) =>
        n.includes("no popover/dialog chrome is generated"),
      ),
    );
  }

  // --- shadcn shell: required primitive genuinely missing -> clear failure, nothing written, other refs unaffected ---
  {
    const dir = shadcnFixture("shadcn-missing-popover", {
      presentComponents: ["button.tsx", "switch.tsx", "toggle-group.tsx", "toggle.tsx"],
    }); // popover.tsx deliberately absent
    await assert.rejects(
      buildInitPlan(detectProject(dir), {
        adapter: "shadcn",
        shell: "popover",
      }),
      UsageError,
    );
    const message = await buildInitPlan(detectProject(dir), {
      adapter: "shadcn",
      shell: "popover",
    }).catch((e) => e.message);
    assert.match(message, /requires the shadcn Popover component/);
    assert.match(message, /npx shadcn add popover/);
    assert.ok(!existsSync(path.join(dir, SHELL_PATH)), "nothing was written");
    assert.ok(
      !existsSync(path.join(dir, CONFIG_PATH)),
      "the whole plan aborts before anything else is written either",
    );
  }

  // --- shadcn shell: BOTH required primitives missing -> both named together ---
  {
    const dir = shadcnFixture("shadcn-missing-both", { presentComponents: ["switch.tsx", "toggle-group.tsx", "toggle.tsx"] });
    const message = await buildInitPlan(detectProject(dir), {
      adapter: "shadcn",
      shell: "dialog",
    }).catch((e) => e.message);
    assert.match(message, /requires the shadcn Button and Dialog components/);
    assert.match(message, /npx shadcn add button dialog/);
  }

  // --- backend detection: Base UI popover shell, components.json "style": "base-vega" (signal 1, prefixed) ---
  // --- -> generates `render`, never `asChild`, exactly one <Button>, typechecks against the fixture's own Base UI-flavored stub ---
  {
    const dir = shadcnFixture("shadcn-base-popover", {
      style: "base-vega",
      backend: "base",
    });
    const plan = await buildInitPlan(detectProject(dir), {
      adapter: "shadcn",
      shell: "popover",
    });
    const shell = plan.files.find((f) => f.path === SHELL_PATH);
    assert.ok(shell, "trim/TrimShell.tsx is planned");
    assert.match(
      shell.contents,
      /import \{ Button \} from "@\/components\/ui\/button";/,
    );
    assert.match(
      shell.contents,
      /import\s*\{\s*Popover,\s*PopoverContent,\s*PopoverTrigger,\s*\}\s*from\s*"@\/components\/ui\/popover";/,
    );
    assert.match(
      shell.contents,
      /<PopoverTrigger\s+render=\{<Button variant="outline" \/>\}>\s*Accessibility\s*<\/PopoverTrigger>/,
    );
    assert.doesNotMatch(
      shell.contents,
      /asChild/,
      "never emits Radix's asChild for a Base UI backend",
    );
    assert.equal(
      (shell.contents.match(/<Button\b/g) ?? []).length,
      1,
      "exactly one Button element — never a nested/duplicated interactive element",
    );

    await applyInitPlan(dir, plan);
    writeFileSync(
      path.join(dir, "tsconfig.check.json"),
      JSON.stringify({
        compilerOptions: {
          target: "es2020",
          module: "esnext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          baseUrl: ".",
          paths: { "@/*": ["./*"] },
        },
        include: [CONFIG_PATH, SHELL_PATH, TRIM_PANEL_PATH],
      }),
      "utf8",
    );
    execFileSync(
      "node",
      [
        path.join(root, "node_modules/typescript/bin/tsc"),
        "-p",
        "tsconfig.check.json",
      ],
      { cwd: dir },
    );
  }

  // --- backend detection: Base UI dialog shell — same `render` composition, typechecks ---
  {
    const dir = shadcnFixture("shadcn-base-dialog", {
      style: "base-vega",
      backend: "base",
    });
    const plan = await buildInitPlan(detectProject(dir), {
      adapter: "shadcn",
      shell: "dialog",
    });
    const shell = plan.files.find((f) => f.path === SHELL_PATH);
    assert.match(
      shell.contents,
      /import \{ Dialog, DialogContent, DialogTrigger \} from "@\/components\/ui\/dialog";/,
    );
    assert.match(
      shell.contents,
      /<DialogTrigger render=\{<Button variant="outline" \/>\}>Accessibility<\/DialogTrigger>/,
    );
    assert.doesNotMatch(shell.contents, /asChild/);
    assert.equal((shell.contents.match(/<Button\b/g) ?? []).length, 1);

    await applyInitPlan(dir, plan);
    writeFileSync(
      path.join(dir, "tsconfig.check.json"),
      JSON.stringify({
        compilerOptions: {
          target: "es2020",
          module: "esnext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          baseUrl: ".",
          paths: { "@/*": ["./*"] },
        },
        include: [CONFIG_PATH, SHELL_PATH, TRIM_PANEL_PATH],
      }),
      "utf8",
    );
    execFileSync(
      "node",
      [
        path.join(root, "node_modules/typescript/bin/tsc"),
        "-p",
        "tsconfig.check.json",
      ],
      { cwd: dir },
    );
  }

  // --- backend detection signal 2 (fallback): no "style" key at all -> grep the installed popover.tsx's own imports ---
  {
    const baseDir = shadcnFixture("shadcn-fallback-base", {
      style: undefined,
      backend: "base",
    });
    const basePlan = await buildInitPlan(detectProject(baseDir), {
      adapter: "shadcn",
      shell: "popover",
    });
    const baseShell = basePlan.files.find((f) => f.path === SHELL_PATH);
    assert.match(
      baseShell.contents,
      /render=\{<Button variant="outline" \/>\}/,
      'no "style" key -> falls through to grepping popover.tsx\'s own (Base UI) imports',
    );

    const radixDir = shadcnFixture("shadcn-fallback-radix", {
      style: undefined,
      backend: "radix-hint",
    });
    const radixPlan = await buildInitPlan(detectProject(radixDir), {
      adapter: "shadcn",
      shell: "popover",
    });
    const radixShell = radixPlan.files.find((f) => f.path === SHELL_PATH);
    assert.match(
      radixShell.contents,
      /<PopoverTrigger asChild>/,
      'no "style" key -> falls through to grepping popover.tsx\'s own (Radix) imports',
    );
  }

  // --- backend detection: an unrecognized (non-prefixed, non-legacy) "style" value is ALSO inconclusive at signal 1 -> falls through to signal 2 ---
  {
    const dir = shadcnFixture("shadcn-unrecognized-style-falls-through", {
      style: "my-custom-theme",
      backend: "base",
    });
    const plan = await buildInitPlan(detectProject(dir), {
      adapter: "shadcn",
      shell: "popover",
    });
    const shell = plan.files.find((f) => f.path === SHELL_PATH);
    assert.match(
      shell.contents,
      /render=\{<Button variant="outline" \/>\}/,
      '"my-custom-theme" matches no known prefix and is not a known legacy value, so signal 1 defers to signal 2',
    );
  }

  // --- backend detection: React Aria is recognized but not yet supported -> clean, SPECIFIC refusal naming React Aria, zero writes ---
  {
    const dir = shadcnFixture("shadcn-aria-refused", {
      style: "aria-lyra",
      presentComponents: ["button.tsx", "popover.tsx", "switch.tsx", "toggle-group.tsx", "toggle.tsx"],
    });
    await assert.rejects(
      buildInitPlan(detectProject(dir), {
        adapter: "shadcn",
        shell: "popover",
      }),
      UsageError,
    );
    const message = await buildInitPlan(detectProject(dir), {
      adapter: "shadcn",
      shell: "popover",
    }).catch((e) => e.message);
    assert.match(
      message,
      /React Aria/,
      'names React Aria specifically, not a generic "unknown backend" message',
    );
    assert.match(
      message,
      /"style":\s*"aria-\.\.\."/,
      "names the exact detection signal",
    );
    assert.ok(!existsSync(path.join(dir, SHELL_PATH)), "nothing was written");
    assert.ok(
      !existsSync(path.join(dir, CONFIG_PATH)),
      "the whole plan aborts before anything else is written either",
    );
  }

  // --- backend detection: genuinely undetectable (no "style" key, and installed components import nothing recognizable) -> distinct refusal, zero writes ---
  {
    const dir = shadcnFixture("shadcn-undetectable-refused", {
      style: undefined,
      backend: undefined,
    });
    await assert.rejects(
      buildInitPlan(detectProject(dir), {
        adapter: "shadcn",
        shell: "popover",
      }),
      UsageError,
    );
    const message = await buildInitPlan(detectProject(dir), {
      adapter: "shadcn",
      shell: "popover",
    }).catch((e) => e.message);
    assert.match(message, /could not determine which shadcn primitive backend/);
    assert.doesNotMatch(
      message,
      /React Aria/,
      "a genuinely undetectable backend gets a distinct message from the Aria-specific one",
    );
    assert.ok(!existsSync(path.join(dir, SHELL_PATH)), "nothing was written");
    assert.ok(
      !existsSync(path.join(dir, CONFIG_PATH)),
      "the whole plan aborts before anything else is written either",
    );
  }

  // --- apply + idempotency: create, then re-plan against disk shows "matches", zero writes needed ---
  {
    const dir = fixture("idempotent", { tsconfig: "{}" });
    const project = detectProject(dir);
    const firstPlan = await buildInitPlan(project, VANILLA_POPOVER_DEFAULT);
    assert.ok(firstPlan.files.every((f) => f.status === "create"));
    await applyInitPlan(dir, firstPlan);
    assert.ok(existsSync(path.join(dir, CONFIG_PATH)));
    assert.ok(existsSync(path.join(dir, STARTER_CONTROL_PATH)));
    assert.ok(existsSync(path.join(dir, MANIFEST_PATH)));
    assert.ok(existsSync(path.join(dir, SETTINGS_PATH)));
    assert.ok(existsSync(path.join(dir, TRIM_JSON_PATH)));

    const secondPlan = await buildInitPlan(project, VANILLA_POPOVER_DEFAULT);
    assert.ok(
      secondPlan.files.every((f) => f.status === "matches"),
      "re-planning with identical answers reports every file as already matching",
    );
  }

  // --- trim.json specifically: re-running with a DIFFERENT (but config-invisible) answer is "update", never "conflict" ---
  // --- (it is never allowed to block the whole plan on its own) — styling never appears in trim.config.tsx's content, ---
  // --- so changing it alone leaves every other core file byte-identical; changing ui.adapter/ui.shell instead WOULD ---
  // --- conflict on trim.config.tsx itself, since that file's content genuinely encodes them (see the "conflict" case below). ---
  {
    const dir = fixture("trim-json-update", { tsconfig: "{}" });
    const project = detectProject(dir);
    await applyInitPlan(
      dir,
      await buildInitPlan(project, VANILLA_POPOVER_DEFAULT),
    );

    const changedPlan = await buildInitPlan(project, {
      adapter: "vanilla",
      shell: "popover",
      styling: "tokens",
    });
    const trimJsonEntry = changedPlan.files.find(
      (f) => f.path === TRIM_JSON_PATH,
    );
    assert.equal(
      trimJsonEntry.status,
      "update",
      "a different styling answer updates trim.json rather than conflicting with its previous self",
    );
    const coreFiles = changedPlan.files.filter(
      (f) => f.path !== TRIM_JSON_PATH && f.path !== TOKENS_CSS_PATH,
    );
    assert.ok(
      coreFiles.every((f) => f.status === "matches"),
      "config/starter control/manifest/settings are unaffected by the styling change",
    );
    assert.equal(
      changedPlan.files.find((f) => f.path === TOKENS_CSS_PATH).status,
      "create",
      "trim.css is a new, safe addition — never blocks the plan on its own",
    );

    await applyInitPlan(dir, changedPlan);
    assert.equal(
      parseTrimMetadata(readFileSync(path.join(dir, TRIM_JSON_PATH), "utf8"))
        .styling,
      "tokens",
      "the update actually applied",
    );
  }

  // --- conflict: a hand-edited file is never overwritten, "matches" files are never blocked by it ---
  {
    const dir = fixture("conflict", { tsconfig: "{}" });
    const project = detectProject(dir);
    await applyInitPlan(
      dir,
      await buildInitPlan(project, VANILLA_POPOVER_DEFAULT),
    );
    const handEdited =
      generateConfigContents({ adapter: "vanilla", shell: "popover" }) +
      "// hand-edited\n";
    writeFileSync(path.join(dir, CONFIG_PATH), handEdited, "utf8");

    const plan = await buildInitPlan(project, VANILLA_POPOVER_DEFAULT);
    const configEntry = plan.files.find((f) => f.path === CONFIG_PATH);
    assert.equal(configEntry.status, "conflict");
    assert.ok(
      plan.files
        .filter((f) => f.path !== CONFIG_PATH)
        .every((f) => f.status === "matches"),
      "identical existing files are never themselves flagged, even alongside a real conflict",
    );

    await applyInitPlan(dir, plan); // must be a no-op for the conflicting file
    assert.equal(
      readFileSync(path.join(dir, CONFIG_PATH), "utf8"),
      handEdited,
      "the hand-edited file is untouched — no destructive overwrite",
    );
  }

  // --- conflict: changing ui.adapter on a rerun genuinely conflicts with the existing trim.config.tsx (it encodes ui.adapter/ui.shell now) ---
  {
    const dir = fixture("conflict-adapter-change", { tsconfig: "{}" });
    const project = detectProject(dir);
    await applyInitPlan(
      dir,
      await buildInitPlan(project, VANILLA_POPOVER_DEFAULT),
    );

    const plan = await buildInitPlan(project, { adapter: "headless" });
    assert.equal(
      plan.files.find((f) => f.path === CONFIG_PATH).status,
      "conflict",
      "trim.config.tsx now embeds ui.adapter, so a different adapter on a rerun is a real conflict, not silently rewritten",
    );
  }

  // --- TRANSACTIONAL: one conflict + otherwise-missing files => NOTHING is created, not even the safe ones ---
  {
    const dir = fixture("transactional-abort", { tsconfig: "{}" });
    mkdirSync(path.join(dir, "trim"), { recursive: true });
    // Only trim.config.tsx exists, and with content that will conflict —
    // the starter control, manifest.ts, settings.ts and trim.json are all still missing.
    writeFileSync(
      path.join(dir, CONFIG_PATH),
      "// not what Trim would generate\n",
      "utf8",
    );

    const plan = await buildInitPlan(
      detectProject(dir),
      VANILLA_POPOVER_DEFAULT,
    );
    const statuses = Object.fromEntries(
      plan.files.map((f) => [f.path, f.status]),
    );
    assert.equal(statuses[CONFIG_PATH], "conflict");
    assert.equal(statuses[STARTER_CONTROL_PATH], "create");
    assert.equal(statuses[MANIFEST_PATH], "create");
    assert.equal(statuses[SETTINGS_PATH], "create");
    assert.equal(statuses[TRIM_JSON_PATH], "create");

    // The command-level contract (cli/commands/init.ts): a plan containing
    // any "conflict" must never reach applyInitPlan at all. Simulate that
    // contract directly here to prove the missing files stay missing —
    // runInitCommand's own enforcement of it is proven separately below.
    const hasConflict = plan.files.some((f) => f.status === "conflict");
    assert.ok(hasConflict);
    if (!hasConflict) await applyInitPlan(dir, plan);

    assert.ok(
      !existsSync(path.join(dir, STARTER_CONTROL_PATH)),
      "a file that was safe to create is NOT created when another file in the same plan conflicts",
    );
    assert.ok(!existsSync(path.join(dir, MANIFEST_PATH)));
    assert.ok(!existsSync(path.join(dir, SETTINGS_PATH)));
    assert.ok(!existsSync(path.join(dir, TRIM_JSON_PATH)));
  }

  // --- runInitCommand: TypeScript is required, no prompting happens for a JS-only project ---
  {
    const dir = fixture("run-js-only", { tsconfig: null });
    let promptCalled = false;
    const trackingPrompter = {
      async input() {
        promptCalled = true;
        return "";
      },
      async select() {
        promptCalled = true;
        return "default";
      },
      async confirm() {
        promptCalled = true;
        return false;
      },
      async checkbox() {
        promptCalled = true;
        return [];
      },
    };
    await assert.rejects(runInitCommand(dir, trackingPrompter), UsageError);
    assert.equal(
      promptCalled,
      false,
      "a JS-only project is rejected before ever prompting",
    );
  }

  // --- runInitCommand: end-to-end with a stub prompt, then "already initialized" on rerun ---
  {
    const dir = fixture("run-e2e", { tsconfig: "{}" });
    // No components.json -> "Use project shadcn" isn't offered, so the
    // adapter select's choices are [vanilla, headless]; "1"/"1"/"1" =
    // vanilla, popover (shell), default (styling).
    const firstOutput = await swallowLogs(() =>
      runInitCommand(dir, scriptedPrompter(["1", "1", "1"])),
    );
    assert.match(firstOutput, /Trim initialized\./);
    assert.ok(existsSync(path.join(dir, CONFIG_PATH)));
    assert.ok(existsSync(path.join(dir, STARTER_CONTROL_PATH)));
    assert.ok(existsSync(path.join(dir, TRIM_JSON_PATH)));

    const secondOutput = await swallowLogs(() =>
      runInitCommand(dir, scriptedPrompter(["1", "1", "1"])),
    );
    assert.match(secondOutput, /Trim is already initialized — nothing to do\./);
  }

  // --- runInitCommand: a conflict throws UsageError (exit-1-worthy), reports EVERY conflicting file, ---
  // --- and writes NOTHING — not even files that would otherwise be safe creates/updates in the same plan ---
  {
    const dir = fixture("run-conflict", { tsconfig: "{}" });
    await swallowLogs(() =>
      runInitCommand(dir, scriptedPrompter(["1", "1", "1"])),
    );
    writeFileSync(
      path.join(dir, CONFIG_PATH),
      "// hand-edited, not generated\n",
      "utf8",
    );
    writeFileSync(
      path.join(dir, MANIFEST_PATH),
      "// also hand-edited, not generated\n",
      "utf8",
    );

    const output = await swallowLogs(async () => {
      // Same adapter/shell this time, but a different styling answer ("2" =
      // tokens): trim.json would be an "update" (never blocking on its own)
      // alongside the two real "conflict" files.
      await assert.rejects(
        runInitCommand(dir, scriptedPrompter(["1", "1", "2"])),
        UsageError,
      );
    });
    assert.match(output, /! trim\/trim\.config\.tsx/);
    assert.match(output, /! trim\/trim\.manifest\.ts/);
    assert.match(
      output,
      /trim\.config\.tsx, trim\/trim\.manifest\.ts/,
      "every conflicting file is named, not just the first one found",
    );
    assert.match(output, /Nothing was written/);
    // settings.ts was a plain "matches" and trim.json was a safe "update" —
    // neither should have been touched: the whole plan aborted.
    assert.equal(
      readFileSync(path.join(dir, SETTINGS_PATH), "utf8"),
      generateSettingsContents(),
      "an unrelated matching file is untouched by the abort",
    );
    assert.equal(
      parseTrimMetadata(readFileSync(path.join(dir, TRIM_JSON_PATH), "utf8"))
        .styling,
      "default",
      "trim.json keeps its PREVIOUS value — the styling change was never applied because the batch aborted",
    );
  }

  // --- generated files typecheck against the real built package (self-reference) ---
  {
    const dir = fixture("typecheck-generated", {
      tsconfig: '{ "compilerOptions": { "moduleResolution": "bundler" } }',
    });
    await applyInitPlan(
      dir,
      await buildInitPlan(detectProject(dir), {
        adapter: "vanilla",
        shell: "popover",
        styling: "tokens",
      }),
    );
    const relFiles = [
      CONFIG_PATH,
      STARTER_CONTROL_PATH,
      MANIFEST_PATH,
      SETTINGS_PATH,
      TRIM_PANEL_PATH,
    ].map((p) => path.relative(root, path.join(dir, p)));
    execFileSync(
      "node",
      [
        "node_modules/typescript/bin/tsc",
        ...relFiles,
        "--noEmit",
        "--strict",
        "--module",
        "esnext",
        "--moduleResolution",
        "bundler",
        "--target",
        "es2020",
        "--jsx",
        "react-jsx",
        "--skipLibCheck",
      ],
      { cwd: root },
    );
  }

  // --- shadcn shell also typechecks against the real built package + the fixture's own stub components ---
  {
    const dir = shadcnFixture("typecheck-shadcn-shell");
    await applyInitPlan(
      dir,
      await buildInitPlan(detectProject(dir), {
        adapter: "shadcn",
        shell: "popover",
      }),
    );
    writeFileSync(
      path.join(dir, "tsconfig.check.json"),
      JSON.stringify({
        compilerOptions: {
          target: "es2020",
          module: "esnext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          baseUrl: ".",
          paths: { "@/*": ["./*"] },
        },
        include: [CONFIG_PATH, SHELL_PATH, TRIM_PANEL_PATH],
      }),
      "utf8",
    );
    execFileSync(
      "node",
      [
        path.join(root, "node_modules/typescript/bin/tsc"),
        "-p",
        "tsconfig.check.json",
      ],
      { cwd: dir },
    );
  }

  // --- tarball: CLI ships, but no test fixture directories ever leak into it ---
  {
    const json = execFileSync(
      "npm",
      ["pack", "--dry-run", "--ignore-scripts", "--json"],
      { cwd: root, encoding: "utf8" },
    );
    const files = JSON.parse(json)[pkg.name].files.map((f) => f.path);
    assert.ok(files.includes("dist/cli/commands/init.js"));
    assert.ok(files.includes("dist/cli/generators/init-files.js"));
    assert.ok(files.includes("dist/cli/generators/shadcn-shell.js"));
    assert.ok(files.includes("dist/cli/generators/settings-file.js"));
    assert.ok(files.includes("dist/cli/project/detect-project.js"));
    assert.ok(files.includes("dist/cli/project/trim-metadata.js"));
    assert.ok(files.includes("dist/cli/templates/shadcn/shell/popover.tsx"));
    assert.ok(files.includes("dist/cli/templates/shadcn/shell/dialog.tsx"));
    assert.ok(
      files.includes("dist/cli/templates/shadcn/shell/popover-base.tsx"),
    );
    assert.ok(
      files.includes("dist/cli/templates/shadcn/shell/dialog-base.tsx"),
    );
    assert.ok(
      !files.some((f) => f.startsWith(".trim-cli-init-test-")),
      "no test fixture directory leaks into the tarball",
    );
    assert.ok(
      !files.some((f) => f.startsWith("cli/")),
      "raw cli/ source still never ships",
    );
  }

  console.log(
    'PASS CLI init: stripJsonComments (survives a "//" inside a string value), relativeImportSpecifier (extensionless vs .js), trim.json round trip incl. the optional ui block + malformed rejection, fresh TS/JS-only detection, moduleResolution-driven concise <TrimPanel/> integration snippet, exact generated file contents for each adapter (vanilla/shadcn/headless) including the seeded "starter" control/manifest/settings (real schema, no fake placeholder) and trim/TrimPanel.tsx (both shapes: independent Registry+Panel, and Registry wrapping the generated TrimShell), collectInitAnswers\'s prompt-flow branching (shadcn choice offered iff shadcnConfigured, shell/styling asked iff the adapter answer needs them, the new "Add Trim theme import?" question asked iff adapter vanilla + a safe stylesheet was detected, Yes/No recorded distinctly from never-asked), all vanilla styling choices, adapter: headless (no shell key, no CSS), shadcn chosen-but-not-configured (falls back to vanilla, never records ui.adapter: "shadcn"), shadcn chosen-and-configured (TrimShell.tsx generated for popover/dialog, correctly aliased + "use client" + relative config import), shadcn primitive backend detection (components.json "style" prefix radix|base|aria authoritative, legacy unprefixed style values back-compat to radix, an unrecognized style value falls through same as a missing style key, signal-2 fallback grepping an installed popover/button import), Base UI backend generates `render` composition (never asChild, exactly one Button) for both popover and dialog shells and typechecks, Radix backend unaffected, React Aria recognized-but-unsupported refuses with a message naming React Aria specifically, a genuinely undetectable backend refuses with a distinct message, both refusals write nothing, shadcn shell "inline" needs no wrapper file and no primitive at all, shadcn shell missing-primitive failure (single and both-missing, exact "npx shadcn add ..." guidance, nothing written), shadcn declined, apply + idempotency, the opt-in global-stylesheet import edit (exact appended @import line(s) incl. a real relative path to trim.css for "tokens" styling, "update" status, idempotent on rerun, declining/no-detected-stylesheet leaves the file untouched and prints the manual instruction, folded into the same transactional all-or-nothing plan), trim.json "update" on a styling-only change (never blocking, config/starter/manifest/settings untouched), a genuine ui.adapter change instead conflicts with existing trim.config.tsx, conflict detection (never overwrites, never blocks unrelated matches), TRANSACTIONAL abort (one conflict blocks every otherwise-safe create/update in the same plan, including the stylesheet edit, every conflicting file is named), runInitCommand end to end, generated files (incl. the shadcn shell and TrimPanel.tsx in both shapes) typecheck against the real built package, tarball ships CLI dist but never test fixtures or raw cli/ source',
  );
} finally {
  rmSync(testRoot, { recursive: true, force: true });
}
