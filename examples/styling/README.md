# Styling examples

Three ways to map a host design system onto Trim's `--trim-*` token contract.
See the main [README's Styling section](../../README.md#styling--css-customization)
for the full explanation; these files are the copy-paste starting point.

Each file assumes the same ordering:

```css
@import "@theharborproject/trim/panel.css";
@import "./trim.css"; /* one of the files below, renamed */
```

- [`vanilla.css`](./vanilla.css) — direct token overrides, no build step.
- [`tailwind.css`](./tailwind.css) — Tailwind v4 host variables, defined by
  the host (Tailwind ships no universal semantic variables of its own).
- [`shadcn.css`](./shadcn.css) — shadcn/ui's semantic variable convention
  (`--background`, `--foreground`, `--muted-foreground`, `--border`,
  `--radius`), mapped directly.

These are examples, not a package export — nothing here ships in `dist/` or
is importable from `@theharborproject/trim`.
