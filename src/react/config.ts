// Trim — the React-specific composition config. TrimConfig embeds a
// ComponentType (a custom layout, and a control's own renderer override), so
// this whole module is React-specific by construction: it lives in and is
// exported only from @theharborproject/trim/react, never core. No "use
// client" — nothing here is a hook or an event handler (see
// ./renderer-contract.ts's own comment on that same boundary): defineTrimConfig
// and its dev-mode validator are plain data functions, safe anywhere.
//
// TrimConfig answers "where and how is a control composed", never "what is
// it" — that question belongs entirely to define*Control() (see
// ../core/define-controls.ts). Composition never appears inside a
// *.trim.ts control file.

import type { ComponentType } from "react";
import type { TrimCore } from "../core/integration";
import type { TrimRegistry } from "../core/registry";
import { findControl } from "../advanced/resolution";
import type { TrimControlRendererProps } from "./renderer-contract";

export type TrimGroupItem =
  | string
  | { id: string; component: ComponentType<TrimControlRendererProps<any>> };

export type TrimGroupDef = {
  id: string;
  label?: string;
  collapsed?: boolean;
  controls: readonly TrimGroupItem[];
};

/**
 * One resolved, renderable slot: `ref` is the registry ref this item points
 * at (a bare id already expanded to "<id>.value" — see resolveTrimGroups
 * below), `component` is the per-item renderer override, if any.
 * Deliberately not resolved any further than this — a control's live
 * value/setValue can only come from calling useTrimControlState(ref) inside
 * an actual render, so this stays a passive lookup pair, never a snapshot.
 */
export type TrimResolvedGroupItem = {
  ref: string;
  component?: ComponentType<TrimControlRendererProps<any>>;
};

export type TrimResolvedGroup = {
  id: string;
  label?: string;
  collapsed?: boolean;
  items: readonly TrimResolvedGroupItem[];
};

/**
 * The public props contract for a custom `layout` component — exactly what
 * DefaultSectionsLayout (../layouts/sections.tsx) itself implements. This is
 * the one "resolved" shape exposed publicly, and only because a custom
 * layout genuinely cannot exist without it: there is no other way for a
 * host-authored layout component to receive "which controls, in what order,
 * in what groups" from a statically-defined TrimConfig.
 */
export type TrimLayoutProps = {
  groups: readonly TrimResolvedGroup[];
  registry?: TrimRegistry;
};

export type TrimConfig = {
  // "flat" is deliberately not offered yet — no implementation exists for
  // it in this step, and a union member with nothing behind it is exactly
  // the kind of speculative surface this package avoids.
  layout: "sections" | ComponentType<TrimLayoutProps>;
  groups: readonly TrimGroupDef[];
};

/**
 * "theme" -> "theme.value" (the manifest adapter's fixed sub-key — see
 * ./manifest.ts); "loader.spinnerToggle" (already dotted) is used literally,
 * so a group can still reference one specific control inside a
 * hand-authored, multi-control <Trim.Integration>.
 */
function resolveGroupItemRef(id: string): string {
  return id.includes(".") ? id : `${id}.value`;
}

/**
 * Pure: expands bare ids and carries component overrides through unchanged.
 * No registry access at all — a control's live value can only be resolved
 * inside an actual render (see ../layouts/sections.tsx's LayoutItem), and
 * grouping/ordering here is already exactly what the array order says, so
 * there is nothing left to sort or rediscover.
 */
export function resolveTrimGroups(groups: readonly TrimGroupDef[]): readonly TrimResolvedGroup[] {
  return groups.map(group => ({
    id: group.id,
    label: group.label,
    collapsed: group.collapsed,
    items: group.controls.map(item =>
      typeof item === "string"
        ? { ref: resolveGroupItemRef(item) }
        : { ref: resolveGroupItemRef(item.id), component: item.component },
    ),
  }));
}

function warnOnDuplicateGroupIds(groups: readonly TrimGroupDef[]): void {
  const seen = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.id)) {
      console.error(`Trim: duplicate group id "${group.id}" in defineTrimConfig({ groups: [...] }) — group ids are used as React keys and must be unique.`);
    }
    seen.add(group.id);
  }
}

/**
 * `is_unique` is optional on a control (see core/integration.ts): undefined
 * and true both mean "unique", only an explicit false allows a control to
 * appear more than once across `groups`. This can only be checked against
 * the actual registered TrimControl objects, which defineTrimConfig has no
 * access to at trim.config.tsx module-evaluation time — so, unlike
 * warnOnDuplicateGroupIds, this runs where the config is actually resolved
 * against the live registry (<Trim.Panel config={...}>), not inside
 * defineTrimConfig itself. A ref that doesn't resolve to any control is
 * skipped here — <Trim.Panel>'s own per-item render already reports that
 * separately, and "not found" is not a uniqueness violation.
 *
 * Self-gated (like defineTrimConfig below), so a caller can call this
 * unconditionally — the entire scan, not just its console output, is
 * skipped in production.
 */
export function warnOnUniquenessViolations(groups: readonly TrimResolvedGroup[], integrations: readonly TrimCore[]): void {
  if (process.env.NODE_ENV === "production") return;
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const item of group.items) counts.set(item.ref, (counts.get(item.ref) ?? 0) + 1);
  }
  for (const [ref, count] of counts) {
    if (count <= 1) continue;
    const control = findControl(integrations, ref);
    if (!control || control.is_unique === false) continue;
    console.error(
      `Trim: control "${ref}" is attached ${count} times in this layout, but is not marked \`is_unique: false\` — set \`is_unique: false\` on its definition to allow multiple attachments, or remove the extra one(s).`,
    );
  }
}

/**
 * Identity at runtime — exists for inference and a dev-only validation pass.
 * Validates composition concerns only (duplicate group ids); never host
 * state or bindings, and never anything requiring the registry (see
 * warnOnUniquenessViolations above for why that check lives elsewhere).
 */
export function defineTrimConfig(config: TrimConfig): TrimConfig {
  if (process.env.NODE_ENV !== "production") warnOnDuplicateGroupIds(config.groups);
  return config;
}
