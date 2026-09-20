// Trim — pure control/integration resolution. No React import: these
// operate on plain data (a TrimCore[] array, a TrimBinding) and are directly
// unit-testable with no renderer, no hooks. @theharborproject/trim/react's
// hooks.ts is a thin useSyncExternalStore/useMemo wrapper around exactly
// these functions — moved here (not into ../core) because they're organized
// by audience (a custom-renderer/advanced consumer), not because they need
// the React-only entry: nothing in this file imports "react".

import type { TrimCore, TrimControl } from "../core/integration";
import type { TrimBinding } from "../core/bindings";

export function findIntegration(integrations: readonly TrimCore[], id: string): TrimCore | undefined {
  return integrations.find(integration => integration.id === id);
}

/** Splits "loader.value" into {integrationId: "loader", controlId: "value"}. Throws on a ref with no ".". */
export function resolveControlRef(ref: string): { integrationId: string; controlId: string } {
  const separator = ref.indexOf(".");
  if (separator === -1) {
    throw new Error(`Trim: invalid control id "${ref}" — expected "<integrationId>.<controlId>".`);
  }
  return { integrationId: ref.slice(0, separator), controlId: ref.slice(separator + 1) };
}

/**
 * The inverse of resolveControlRef: builds a "<integrationId>.<controlId>"
 * ref with a precise literal type. Trim itself has no registry of "known"
 * integration/control ids (a host's schema is never visible to the core) —
 * this only helps a caller who already has ids as literal or generically-
 * typed strings avoid hand-writing the template and typo-ing the separator.
 * A host that wants full compile-time checking against its *own* set of
 * registered ids should instead derive a union type from its own
 * integration declarations and type its call sites against that —
 * trimControlRef stays a plain, schema-agnostic string builder.
 */
export function trimControlRef<I extends string, C extends string>(integrationId: I, controlId: C): `${I}.${C}` {
  return `${integrationId}.${controlId}`;
}

export function findControl<V = unknown>(integrations: readonly TrimCore[], ref: string): TrimControl<V> | undefined {
  const { integrationId, controlId } = resolveControlRef(ref);
  const integration = findIntegration(integrations, integrationId);
  // Only truly generic for "custom" controls — see useTrimControlState's comment (react/hooks.ts).
  return integration?.controls[controlId] as TrimControl<V> | undefined;
}

export function controlSnapshot<V>(binding: TrimBinding<V> | undefined): V | undefined {
  return binding ? binding.get() : undefined;
}

export function subscribeToControl<V>(binding: TrimBinding<V> | undefined, listener: () => void): () => void {
  if (!binding) return () => {};
  return binding.subscribe(() => listener());
}
