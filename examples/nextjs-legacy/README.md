# Trim 0.2 Next.js App Router fixture

A real Next.js (App Router) application proving `ui.adapter`/`ui.shell`
work end to end in the environment they're most likely to actually run in
— including the one thing static reasoning can't settle on its own:
whether `@theharborproject/trim/react`'s exports can be rendered directly
from a Server Component (`app/layout.tsx`) without Next.js failing to
build. They can, with **no changes needed** — `panel.tsx`/`index.ts`
already carry a package-level `"use client"` pragma (predating this
adapter/shell feature), and it survives this package's `tsc` build
unchanged into `dist/` (verified by inspecting the built output directly,
and by this fixture's own successful `next build`).

Own standalone npm project (own `package.json`/`package-lock.json`/
`node_modules`, installed with a `file:../..` dependency on the package
root — resolved as a real host would via `node_modules`, not TypeScript's
self-reference trick `examples/default/`'s test uses). Not part of the
published npm package (`package.json`'s `"files"` only ever lists `dist`)
and not compiled by the root `build` script.

## Structure

Four independent Trim setups, each a real `trim init` output (run via the
same `runInitCommand` production code path the real CLI binary calls,
scripted with a fake `Prompter` instead of a live TTY — see
`tests/cli-init.test.mjs` for the established pattern this reuses):

- **`trim/`** (this project's root `trim/` — the realistic case: a real
  `components.json` + `components/ui/{button,popover}.tsx` live at this
  same root, since a real shadcn setup's path aliases are resolved from
  the project root, same as `trim/TrimShell.tsx`'s generated
  `"@/components/ui/..."` imports need to be). **shadcn adapter, popover
  shell, Radix primitive backend** (`components.json`'s `"style":
  "default"`, no recognized `radix-`/`base-`/`aria-` prefix — the legacy
  back-compat case, see `cli/project/shadcn-config.ts`'s `ShadcnSetup.backend`).
  Rendered on `/shadcn` via `components/ShadcnDemo.tsx`.
- **`integrations/shadcn-base/trim/`** — its own real `components.json`
  (`"style": "base-vega"` — a recognized prefix, signal 1) +
  `components/ui/{button,popover}.tsx` written against Base UI's real
  `render`-prop composition contract (never Radix's slot-based `asChild`).
  **shadcn adapter, popover shell, Base UI primitive backend.** Proves the
  same `TrimShell` generator picks structurally different composition
  syntax purely from the detected backend — no nested `<button>`, no
  `asChild` anywhere. Rendered on `/shadcn-base` via
  `components/ShadcnBaseDemo.tsx`.
- **`integrations/vanilla/trim/`** — **vanilla adapter, popover shell**.
  Rendered globally from `app/layout.tsx` (a Server Component) via
  `components/VanillaGlobalPanel.tsx`, on every page.
- **`integrations/headless/trim/`** — **headless adapter** (no shell
  concept, no generated wrapper file). Rendered on `/headless` via
  `components/HeadlessDemo.tsx`.

Each demo component creates its own `createTrimRegistry()` instance (via
`useMemo`) instead of relying on the package's shared default registry —
mounting more than one of these at once (the global layout panel is always
mounted alongside whichever page is active) needs real isolation, not just
views onto one shared registry.

`components/ui/button.tsx` / `components/ui/popover.tsx` (root, Radix) and
`integrations/shadcn-base/components/ui/button.tsx` / `popover.tsx` (Base
UI) are this fixture's own hand-written local components (real, functional
— a context-based disclosure widget for Popover; `asChild` prop-merging on
the Radix Button vs. a `render`-prop-composing PopoverTrigger on the Base
UI side — not a stand-in), namespaced `data-fixture-*`/`trim-fixture-*` so
they can never be mistaken for Trim's own `data-trim-*` chrome. Not pulled
from shadcn's CLI (no network dependency on registry hosts for this
repo's own fixture, and no real `@radix-ui`/`@base-ui` dependency anywhere
in this repo either); "hand-installed" per this feature's own spec.

## Running it

```sh
npm install   # from this directory
npm run build # next build
npm run dev
```
