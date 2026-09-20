# Trim 0.2 canonical example

Composition (`trim.config.tsx`), the custom renderer, the host state
stand-in, and the panel entry point are hand-written. The three files
Trim's own CLI owns — `trim/controls/*.trim.ts`, `trim/trim.manifest.ts`,
`trim/trim.settings.ts` — are produced by literally calling the same
generator functions `trim new control` uses (see each file's own "Generated
by Trim" header), so they can never silently drift out of sync with what
that command actually generates. `trim add @default/example` installs this
same demonstration into a real project by calling those same generators
live, plus copying the renderer/host-stub/panel-entry files from this very
directory (see `cli/generators/example-plan.ts`) — this directory is their
one canonical source, not a second hand-maintained copy.

Every import here goes through `@theharborproject/trim`'s public entry
points; nothing reaches into the package's source. It exists to prove the
0.2 public API is sufficient on its own.

Not part of the published npm package (see `package.json`'s `"files"`) and
not compiled by the package's own `build` script.

## Files

- **`trim/controls/theme.trim.ts`** — a segmented control (`light` / `dark`
  / `system`) with **Trim-managed state**: its binding comes from
  `trim/trim.settings.ts`. Referenced in `trim.config.tsx` as the bare id
  `"theme"`, which resolves to `"theme.value"` and renders with Trim's
  default segmented renderer — no override.
- **`trim/controls/contrast.trim.ts`** — a boolean control with
  **host-managed state**: its binding is `callback(getContrast, setContrast,
  subscribeContrast)`, wired straight to `host/contrast-store.ts`, a plain
  module this example owns. Trim never sees anything but get/set/subscribe.
  Rendered with a **custom renderer** (`trim/renderers/custom-contrast.tsx`).
- **`trim/controls/animations.trim.ts`** — Trim-managed again (same
  `trim.settings.ts` controller), and the one with `is_unique: false`:
  `trim.config.tsx` attaches it twice (once under "Motion", once again
  under "Vision"). Both attachments share the exact same binding, so they
  are always in sync — Trim never models "two instances" as two pieces of
  state.
- **`trim/renderers/custom-contrast.tsx`** — imports only the public
  `TrimControlRendererProps` contract. Receives `{ control, value, setValue
  }` already resolved; it never touches the registry, a binding, or the
  manifest adapter.
- **`trim/trim.manifest.ts`** — statically imports the three `*.trim.ts`
  files and exports the array passed to `<Trim.Registry controls={...}>`.
  No `import.meta.glob`, no dynamic `import()` discovery, no filesystem
  scan — exactly what a generator would also have to produce, since the
  package itself does none of this at runtime.
- **`trim/trim.settings.ts`** — host-owned, built from the public
  `createTrimController()` + `controller()`. The package keeps no hidden
  global settings singleton; this object exists only because this file
  creates it.
- **`trim/trim.config.tsx`** — composition only ("where and how", never
  "what"): two groups, **Vision** then **Motion**, in that exact order;
  each group's controls render in the exact order listed. Nothing here is
  resolved by sorting metadata at render time — the array order *is* the
  render order.
- **`example-panel.tsx`** — the whole thing wired together:
  `<Trim.Registry controls={trimControls}><Trim.Panel
  config={trimConfig} /></Trim.Registry>`, styled with Trim's own optional
  default theme (`@theharborproject/trim/themes/default.css`) — no shadcn,
  no Tailwind, no project-token mapping; those are later CLI/template
  concerns, not this example's.

## What this proves

- A bare id in `trim.config.tsx` (`"theme"`) resolves through the manifest
  convention to `"theme.value"`.
- A per-item `{ id, component }` override renders with that component
  instead of any default, receiving exactly `TrimControlRendererProps`.
- Group order and control order come entirely from `trim.config.tsx`'s own
  arrays — no runtime sorting.
- `is_unique: false` genuinely allows one control to be attached more than
  once, sharing state by sharing a binding — not by any new instance
  concept.
- Every piece is reachable from `@theharborproject/trim`, `@theharborproject/trim/react`,
  and `@theharborproject/trim/themes/default.css` alone.
