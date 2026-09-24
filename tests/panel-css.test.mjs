import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const baseCss = read("src/themes/base.css");
const controlsCss = read("src/themes/controls.css");
const shellCss = read("src/themes/shell.css");

const css = [baseCss, controlsCss, shellCss]
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const defaultsMatch = css.match(
  /\[data-trim-panel\]\s*\{([^}]+)\}/,
);

assert.ok(
  defaultsMatch,
  "[data-trim-panel] token defaults exist",
);

const defaults = defaultsMatch[1];

const tokens = new Map(
  [...defaults.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(
    ([, name, value]) => [name, value],
  ),
);

// Complete public token contract.
const publicTokenContract = [
  "surface",
  "surface-raised",
  "surface-selected",
  "bg",
  "ink",
  "muted",
  "line",
  "border",
  "border-strong",
  "hover",
  "pressed",
  "backdrop",
  "font-family",
  "font-size",
  "focus-color",
  "line-height",
  "radius",
  "shell-radius",
  "control-radius",
  "padding",
  "gap",
  "control-min-height",
  "control-padding",
  "control-gap",
  "section-gap",
  "option-gap",
  "border-width",
  "title-weight",
  "shadow",
  "focus-width",
  "focus-offset",
];

for (const name of publicTokenContract) {
  assert.ok(
    tokens.has(`--trim-${name}`),
    `required token: ${name}`,
  );
}

assert.equal(
  tokens.size,
  publicTokenContract.length,
  "theme declares a token not in the documented public contract",
);

for (const [, name] of css.matchAll(/(--[\w-]+)/g)) {
  assert.ok(
    name.startsWith("--trim-"),
    `no host or Tailwind variable: ${name}`,
  );

  assert.ok(
    tokens.has(name),
    `every token has a panel-local default: ${name}`,
  );
}

for (const name of tokens.keys()) {
  assert.ok(
    read("README.md").includes(`\`${name}\``),
    `document token ${name}`,
  );

  if (name !== "--trim-muted") {
    assert.ok(
      css.includes(`var(${name})`),
      `consume token ${name}`,
    );
  }
}

assert.doesNotMatch(
  css,
  /:root|@import|@tailwind|@apply|forced-color-adjust\s*:\s*none|appearance\s*:\s*none|\b(?:animation|transition)\s*:/,
);

assert.equal(
  tokens.get("--trim-bg"),
  "var(--trim-surface)",
  "preserve surface overrides",
);

assert.equal(
  tokens.get("--trim-font-size"),
  "0.875rem",
);

assert.equal(
  tokens.get("--trim-control-min-height"),
  "40px",
);

for (const name of [
  "surface-raised",
  "surface-selected",
  "border",
  "border-strong",
  "hover",
  "pressed",
  "backdrop",
  "shell-radius",
  "control-radius",
  "shadow",
]) {
  assert.ok(tokens.has(`--trim-${name}`), `redesign token: ${name}`);
}

assert.doesNotMatch(shellCss, /backdrop-filter\s*:/, "the default shell is not glass-like");
assert.match(shellCss, /\[data-trim-shell-launcher\]\[aria-expanded="true"\]/);
assert.match(shellCss, /\[data-trim-shell-launcher\]:hover/);
assert.match(shellCss, /\[data-trim-shell-launcher\]:active/);
assert.match(baseCss, /summary\[data-trim-section-title\]::marker/);
assert.match(baseCss, /border-right:\s*1\.5px solid currentColor/);
assert.match(controlsCss, /\[data-trim-control\]\[data-trim-kind="toggle"\]::after\s*\{\s*content:\s*none;/s);
assert.match(controlsCss, /background:\s*var\(--trim-surface-selected\)/);

assert.match(
  css,
  /min-height:\s*var\(--trim-control-min-height\)/,
);

assert.match(
  css,
  /outline:\s*var\(--trim-focus-width\)\s+solid\s+var\(--trim-focus-color\)/,
);

assert.match(
  css,
  /outline-offset:\s*var\(--trim-focus-offset\)/,
);

// Each CSS layer that owns forced-colors behavior must explicitly contain
// its high-contrast overrides. Test the source files directly instead of
// trying to parse nested CSS blocks with a regex.
const forcedCss = [baseCss, controlsCss, shellCss]
  .filter((source) =>
    source.includes("@media (forced-colors: active)"),
  )
  .join("\n");

assert.ok(
  forcedCss.length > 0,
  "explicit forced-colors support",
);

for (const declaration of [
  "color: CanvasText !important",
  "background: Canvas !important",
  "border-color: CanvasText !important",
  "outline: 2px solid Highlight !important",
]) {
  assert.ok(
    forcedCss.includes(declaration),
    declaration,
  );
}

const pkg = JSON.parse(read("package.json"));

assert.deepEqual(
  pkg.sideEffects,
  ["./dist/themes/*.css"],
  "all published Trim theme CSS files are marked as side effects",
);

assert.equal(
  pkg.exports["./themes/base.css"],
  "./dist/themes/base.css",
);

assert.equal(
  pkg.exports["./themes/controls.css"],
  "./dist/themes/controls.css",
);

assert.equal(
  pkg.exports["./themes/shell.css"],
  "./dist/themes/shell.css",
);

assert.equal(
  pkg.exports["./themes/default.css"],
  "./dist/themes/default.css",
  "default.css remains the compatibility facade",
);

assert.equal(
  pkg.exports["./panel.css"],
  "./dist/themes/default.css",
  "panel.css remains a compatibility alias",
);

assert.equal(
  read("src/themes/default.css").trim(),
  [
    '@import "./base.css";',
    '@import "./controls.css";',
    '@import "./shell.css";',
  ].join("\n"),
  "default.css composes all three theme layers",
);

assert.ok(pkg.files.includes("dist"));

console.log(
  "PASS themes: split base/controls/shell contract, documentation, accessibility rules, exports and default.css compatibility facade",
);
