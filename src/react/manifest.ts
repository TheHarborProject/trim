// Trim — internal adapter from a flat, manifest-declared TrimControl list to
// the existing integration-based registry. No registry rewrite: a control
// coming from a manifest becomes a single-control TrimCore exactly the way
// <Trim.Toggle label="…" bind={…}/> (no `id` prop) already does today —
// control.id becomes the integration id, the control itself is stored under
// the fixed key "value", so the resulting ref is "<control.id>.value".
//
// Not part of any public entry point — same boundary as
// buildIntegrationDescriptor in ./components.tsx: exported from this file
// only so ./components.tsx (the sole caller) and this package's own tests
// can reach it directly, never re-exported from ./index.ts.
//
// No React import: registering/unregistering a set of controls is plain
// data manipulation over a TrimRegistry, identical in kind to what
// <Trim.Integration> already does per-control.

import type { TrimControl, TrimCore } from "../core/integration";
import type { TrimRegistry } from "../core/registry";

export function toIntegration(control: TrimControl): TrimCore {
  return {
    id: control.id,
    meta: { label: control.label, description: control.description },
    controls: { value: control },
  };
}

function warnOnDuplicateManifestIds(controls: readonly TrimControl[]): void {
  const seen = new Set<string>();
  for (const control of controls) {
    if (seen.has(control.id)) {
      console.error(`Trim: duplicate control id "${control.id}" in <Trim.Registry controls={...}> — the later entry wins.`);
    }
    seen.add(control.id);
  }
}

/**
 * Registers every control in `controls`, then unregisters whichever ids in
 * `previousIds` are no longer present. Deliberately not a full
 * unregister-then-reregister sweep: registry.register() already no-ops
 * (does not notify) when a control's content hasn't semantically changed, so
 * the only thing left to avoid is unregistering ids that are still current —
 * doing that unconditionally would force every surviving control through a
 * spurious remove+re-add notification on every `controls` change, even ones
 * where nothing about that particular control moved.
 *
 * The duplicate-id scan itself (not just its console output) is gated behind
 * the caller's NODE_ENV check below, so a production build that statically
 * resolves that branch away pays nothing for it — not even the O(n) scan.
 *
 * Returns the new set of currently-registered ids, to be threaded back in as
 * `previousIds` on the next call (see components.tsx's ManifestRegistration).
 */
export function registerManifestControls(
  registry: TrimRegistry,
  controls: readonly TrimControl[],
  previousIds: ReadonlySet<string>,
): Set<string> {
  if (process.env.NODE_ENV !== "production") warnOnDuplicateManifestIds(controls);
  const currentIds = new Set(controls.map(control => control.id));
  for (const control of controls) registry.register(toIntegration(control));
  for (const id of previousIds) {
    if (!currentIds.has(id)) registry.unregister(id);
  }
  return currentIds;
}

/** The cleanup-only counterpart to registerManifestControls — unregisters every id in `ids`. */
export function unregisterManifestControls(registry: TrimRegistry, ids: ReadonlySet<string>): void {
  for (const id of ids) registry.unregister(id);
}
