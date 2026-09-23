# Registry examples

Run `trim example shadcn` (or `vanilla`, `headless`, or another name in the
registry) to copy a complete source example into `./shadcn`. The destination
must not already exist. Trim does not install dependencies or execute scripts.
Read the copied example's README for setup instructions.

The official manifest is
`https://trim.theharborproject.dev/registry/registry.json`, configured in
`cli/registry/client.ts` as `DEFAULT_REGISTRY_URL`. For development, point
`TRIM_REGISTRY_URL` at an HTTP(S) or absolute `file://` manifest URL:

```sh
TRIM_REGISTRY_URL=file:///absolute/path/trim-registry/registry/registry.json trim example shadcn
```

Each `examples[name]` entry has a `path` relative to the manifest directory
and a `files` array of paths relative to that example directory. Both transports
use the same contract: `examples/shadcn` plus `app/page.tsx` resolves to
`registry/examples/shadcn/app/page.tsx`. Files are copied byte-for-byte, including
binary assets and dotfiles. Paths must be relative, without `.` or `..` segments;
local symlinks are rejected. Empty directories and executable permission metadata
are not represented by this file inventory.

In the sibling `trim-registry` repository, run `npm run registry:generate` after
changing example files and before publishing. The generator recursively updates
all inventories, preserving the rest of the manifest. It excludes installed
dependencies (`node_modules`), repository metadata (`.git`), build/cache directories
(`.next`, `out`, `build`, `dist`, `coverage`, `.vercel`, `.turbo`), `.DS_Store`,
TypeScript build-info files, package-manager debug logs, and local `.env` files
(except `.env.example`, `.env.sample`, and `.env.template` variants). File lists
are generated, never maintained by hand. Publish the manifest and inventoried
files together with their directory structure intact.

Trim reads all files before creating the destination. Existing destinations are
never merged or overwritten. If writing fails, Trim removes the directory it
created; if cleanup also fails, the error identifies the partial directory.
Remove or move a previous installation before retrying.

`trim add @default/example` retains its existing generated, in-project behavior.
The bundled templates and local `examples/` directory are unchanged. This addition
only covers examples; it does not enable registry controls, styles, or presets.
