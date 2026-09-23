# Internal test fixtures

These are self-contained Trim API fixtures, not runnable registry applications.

- `default/` contains controls, settings, a manifest, and composition with a
  custom renderer override. `tests/example.test.mjs` combines it with the
  canonical assets in `cli/templates/default/example/` in a temporary directory
  to typecheck and exercise the public API. `tests/cli-add.test.mjs` also compares
  generated control/manifest/settings output against these fixtures.
- `headless/trim/` contains only the config, manifest, control, and settings needed
  by `tests/manifest.test.mjs` to check configured control-reference resolution.

The host state, custom renderer, and panel source belong exclusively to
`cli/templates/default/example/`; do not duplicate them here. Tests do not
require an external registry checkout or network access to registry examples.
