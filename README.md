# Trim

*by The Harbor Project*

**Status: experimental / pre-1.0.** APIs may still change between minor
versions.

Trim is a tiny registry and binding contract for adaptive UI: it connects
declarative controls (toggles, segmented choices, stateful buttons) to state
your app already owns. It ships a settings engine, a default renderer, and a
set of headless hooks — all optional, all built on the same few primitives.

> **Trim does not replace your components.**
> **Trim connects to the state and mechanisms that already drive them.**

A control rendered through Trim reads and writes the exact same value a
hand-written one would — a plain object, `localStorage`, a `MutationObserver`
on an attribute, an existing store. Trim never becomes a second source of
truth for anything it's pointed at.

## Install

```
npm install @theharborproject/trim
```

`react` is an optional peer dependency: the root entry point needs no React
at all — only `@theharborproject/trim/react` and `@theharborproject/trim/advanced` do.

## Quick start

```tsx
import { Trim, controller } from "@theharborproject/trim/react";
import { createTrimController } from "@theharborproject/trim";

const settingsController = createTrimController(
  { theme: ["light", "dark"], density: ["comfortable", "compact"] },
  { theme: "light", density: "comfortable" },
  "my-app-settings",
);

const ThemeTrim = () => (
  <Trim.Integration id="theme" group="appearance">
    <Trim.Segmented label="Theme" bind={controller(settingsController, "theme")}>
      <Trim.Option value="light">Light</Trim.Option>
      <Trim.Option value="dark">Dark</Trim.Option>
    </Trim.Segmented>
  </Trim.Integration>
);

function App() {
  return (
    <Trim.Registry>
      <ThemeTrim />
      <Trim.Panel /> {/* auto-discovers every registered integration */}
    </Trim.Registry>
  );
}
```

## React example

Declare a control once; render it anywhere with `<Trim.Panel>` or your own
markup via the headless hooks. The same binding stays in sync across every
rendered instance:

```tsx
import { useTrimControlState } from "@theharborproject/trim/react";

function MyOwnToggle() {
  const { control, value, setValue } = useTrimControlState<boolean>("theme.value");
  if (!control) return null;
  return (
    <label>
      {control.label}
      <input type="checkbox" checked={value} onChange={e => setValue(e.target.checked)} />
    </label>
  );
}
```

## Headless example

Nothing in `<Trim.Panel>` is inaccessible to your own renderer — it's built
on the same four hooks:

```ts
import { useTrimRegistry, useTrimControlState } from "@theharborproject/trim/react";

function CustomSettingsPage() {
  const integrations = useTrimRegistry(); // readonly TrimCore[]
  return integrations.map(integration => (
    <MyRow key={integration.id} integration={integration} />
  ));
}
```

Or skip React's binding to it entirely and drive a control from anywhere —
`controller()`/`callback()` bindings work outside a component tree too:

```ts
import { controller } from "@theharborproject/trim";

const themeBinding = controller(settingsController, "theme");
themeBinding.get();              // read
themeBinding.set("dark");        // write
themeBinding.subscribe(v => {}); // observe
```

## External state example

Wire Trim to a store that already exists, without rewriting it:

```tsx
import { callback } from "@theharborproject/trim";
import { Trim } from "@theharborproject/trim/react";

// getSnapshot/setTheme/subscribe are your own, pre-existing implementation —
// Trim doesn't need to own them, only read/write/observe through them.
const themeBinding = callback(getSnapshot, setTheme, listener =>
  subscribe(() => listener(getSnapshot())),
);

export const ThemeTrim = () => (
  <Trim.Integration id="theme" group="appearance">
    <Trim.Segmented label="Theme" bind={themeBinding}>
      <Trim.Option value="light">Light</Trim.Option>
      <Trim.Option value="dark">Dark</Trim.Option>
    </Trim.Segmented>
  </Trim.Integration>
);
```

No second store, no duplicated persistence, no change to whatever prepaint
script or attribute your existing system already owns.

## Styling / CSS customization

Trim ships a default skin, but the host owns presentation: the renderer
consumes only `--trim-*` custom properties, and that is the entire contract.
Trim exposes the tokens; the host maps them. Mapping is plain CSS — an
`@import` order and custom-property overrides — not a resolver Trim runs for
you; the package has no settings file, CLI, or framework/design-system
detection, and none is planned as part of its runtime surface.

**Import** — the default skin is opt-in; nothing imports it for you, and you
can skip it entirely and supply every `--trim-*` value yourself:

```ts
import "@theharborproject/trim/themes/default.css";
```

`@theharborproject/trim/panel.css` is kept as a compatibility alias to the
exact same built file (not a second copy) — existing imports of it continue
to work unchanged.

**Stylesheet ordering** — load Trim's optional skin first, then your own
overrides, so your declarations win the cascade:

```css
@import "@theharborproject/trim/themes/default.css";
@import "./trim.css";
```

`./trim.css` is your own file. The three patterns below are what to put in
it; pick whichever matches how your host already manages design tokens.

### Vanilla CSS

Set tokens directly, scoped to `[data-trim-panel]` (never `:root`, so panel
defaults still apply wherever you don't override):

```css
[data-trim-panel] {
  --trim-bg: #fff;
  --trim-ink: #111;
}

html[data-theme="dark"] [data-trim-panel] {
  --trim-bg: #090b0a;
  --trim-ink: #f4f1e8;
}

html[data-theme="light"] [data-trim-panel] {
  --trim-bg: #f5f3f1;
  --trim-ink: #171815;
}
```

### Tailwind v4 host variables

Tailwind v4 has no universal semantic variables of its own — names like
`--background` and `--foreground` are a shadcn/ui convention, not something
Tailwind ships. A Tailwind-only host defines its own palette (in `@theme` or
as plain custom properties) and maps *those* names to Trim's tokens:

```css
/* app.css — host-defined names, not Tailwind defaults */
@theme {
  --color-surface: #fff;
  --color-ink: #111;
  --color-border: #e2e2e2;
}
```

```css
/* trim.css */
[data-trim-panel] {
  --trim-bg: var(--color-surface);
  --trim-ink: var(--color-ink);
  --trim-line: var(--color-border);
}
```

### shadcn semantic variables

shadcn/ui projects already define semantic variables in `globals.css`
(`--background`, `--foreground`, `--muted-foreground`, `--border`,
`--radius`, ...). Because that convention is consistent across shadcn
projects, it can be mapped directly:

```css
[data-trim-panel] {
  --trim-bg: var(--background);
  --trim-ink: var(--foreground);
  --trim-muted: var(--muted-foreground);
  --trim-line: var(--border);
  --trim-radius: var(--radius);
}
```

Runnable versions of all three patterns are in
[`examples/styling`](./examples/styling).

Defaults are scoped to `[data-trim-panel]`, never `:root`. Without host
color overrides, the skin follows `prefers-color-scheme`. Set tokens on the
panel itself, rather than an ancestor whose values the local defaults replace.

The complete token contract (light defaults; dark differences in parentheses):

- `--trim-bg`: `var(--trim-surface)`.
- `--trim-surface`: `#fff` (dark: `#1a1a1a`); retained for 0.1.0 compatibility.
- `--trim-ink`: `#111` (dark: `#f2f2f2`).
- `--trim-muted`: `var(--trim-ink)`; available for host/custom renderer secondary
  text. The current default renderer has no separate muted text styling.
- `--trim-line`: `#ccc` (dark: `#444`).
- `--trim-font-family`: `system-ui, sans-serif`.
- `--trim-font-size`: `0.875rem`.
- `--trim-line-height`: `1.4`.
- `--trim-radius`: `4px`.
- `--trim-padding`: `8px 12px` (sections).
- `--trim-gap`: `0.75rem` (panel).
- `--trim-control-min-height`: `44px` (controls, option labels and summaries).
- `--trim-control-padding`: `0`.
- `--trim-control-gap`: `4px`.
- `--trim-section-gap`: `8px` (section body gap/top margin and toggle gap).
- `--trim-option-gap`: `6px`.
- `--trim-border-width`: `1px`.
- `--trim-title-weight`: `600`.
- `--trim-focus-width`: `2px`.
- `--trim-focus-offset`: `2px`.

Native controls and visible keyboard focus remain intact; no motion is added.
Forced-colors mode uses system colors and a fixed focus outline in preference
to visual tokens, and does not read host theme tokens at all — forced-colors
overrides are never mapped through `--trim-*`. Hosts remain responsible for
contrast in their own themes.

## Architecture

```
@theharborproject/trim                          core — types, settings engine, registry, bindings, controller, define*Control() factories. No React import at all.
@theharborproject/trim/react                     the common path — JSX primitives, default renderer, headless hooks, defineTrimConfig, controller + useSettings(). "use client".
@theharborproject/trim/react/controls/boolean    DefaultBooleanControl, individually importable/tree-shakable.
@theharborproject/trim/react/controls/segmented  DefaultSegmentedControl, individually importable/tree-shakable.
@theharborproject/trim/react/controls/toggle-action  DefaultToggleActionControl, individually importable/tree-shakable.
@theharborproject/trim/react/controls/unsupported-fallback  UnsupportedKindFallback, individually importable/tree-shakable.
@theharborproject/trim/react/layouts/sections    DefaultSectionsLayout, the built-in defineTrimConfig-driven layout.
@theharborproject/trim/advanced                  low-level primitives for a custom renderer or non-default integration.
@theharborproject/trim/themes/default.css        optional stylesheet for the default renderer.
@theharborproject/trim/panel.css                 compatibility alias for the same file as themes/default.css.
```

**Core never sees your actual values.** Trim has no notion of "theme",
"loader", "on"/"off" — every label, option and value lives in your own
integration declarations. **Core never imports React**, so
`@theharborproject/trim` alone is usable from a Server Component, a
non-React framework, or a plain script; `/react` and `/advanced` are where
the React-specific pieces live.

```
src/
├── types.ts
├── core/           settings, registry, integration types, bindings, controller, define*Control() factories
├── react/          JSX declarations, default renderer, headless hooks, defineTrimConfig, controller + useSettings()
│   ├── controls/   granular default renderers (DefaultBooleanControl, DefaultSegmentedControl, DefaultToggleActionControl, UnsupportedKindFallback)
│   └── layouts/    granular default layouts (DefaultSectionsLayout)
├── advanced/       resolution helpers, sorting/grouping, react/controls/* compatibility re-exports
└── themes/         default.css, Trim's optional default skin
```

## Control kinds

- **`toggle`** — a boolean.
- **`segmented`** — a string enum, options defined by `<Trim.Option>` children.
- **`toggle-action`** — a single interactive element with a persistent
  boolean pressed state (the WAI-ARIA "toggle button" pattern).
- `slider` / `action` / `custom` are declared in the type model for forward
  compatibility; the default renderer has no widget for them yet — an
  unsupported kind warns in dev and renders nothing, never throws.

## Development

```
npm install
npm run typecheck
npm run build
npm test
```

`tests/*.mjs` are package-only: they compile straight from `src/` (no build
step needed to iterate) and import nothing outside this package.

## License

MIT © The Harbor Project
