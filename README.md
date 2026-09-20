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

Trim provides a default skin, but the host owns presentation.
Trim components consume only --trim-* tokens.

**Import**

```ts
import "@theharborproject/trim/panel.css";
```

**Override minimal** — load your CSS after the default stylesheet:

```css
[data-trim-panel] {
  --trim-bg: #fff;
  --trim-ink: #111;
}
```

**Theme-aware override**

```css
html[data-theme="dark"] [data-trim-panel] {
  --trim-bg: #090b0a;
  --trim-ink: #f4f1e8;
}

html[data-theme="light"] [data-trim-panel] {
  --trim-bg: #f5f3f1;
  --trim-ink: #171815;
}
```

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
- `--trim-control-min-height`: `24px` (controls, option labels and summaries;
  a fixed 24px accessibility floor applies).
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
to visual tokens. Hosts remain responsible for contrast in their own themes.

**Future direction (not implemented):** a future `trim.settings.json` could
select `"css-resolver": "vanilla" | "tailwind"` (notation for two alternatives,
not literal JSON). Vanilla would use Trim defaults; Tailwind would map the
host design system to the same tokens, for example:

```css
/* Illustrative future resolver output; not part of panel.css. */
[data-trim-panel] {
  --trim-bg: var(--color-background);
  --trim-ink: var(--color-foreground);
  --trim-muted: var(--color-muted-foreground);
  --trim-line: var(--color-border);
}
```

The renderer would stay unchanged: it only consumes `--trim-*`. There is no
resolver, settings parser, CLI, Tailwind dependency or separate `tokens.css`
in this release.

## Architecture

```
@theharborproject/trim            core — types, settings engine, registry, bindings, controller. No React import at all.
@theharborproject/trim/react      the common path — JSX primitives, default renderer, headless hooks, controller + useSettings(). "use client".
@theharborproject/trim/advanced   low-level primitives for a custom renderer or non-default integration.
@theharborproject/trim/panel.css  optional stylesheet for the default renderer.
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
├── core/       settings, registry, integration types, bindings, controller
├── react/      JSX declarations, default renderer, headless hooks, controller + useSettings()
└── advanced/   resolution helpers, sorting/grouping, individual kind widgets
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
