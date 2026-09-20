"use client";

// @theharborproject/trim/react/layouts/sections — Trim's default
// config-driven layout. Consumes already-resolved groups/order (see
// ../config.ts's resolveTrimGroups) and renders each item by dispatching to
// the appropriate default renderer, or to a per-item `component` override
// when the config provided one.
//
// Does not sort, does not rediscover groups from registry metadata, does
// not mutate config, and knows nothing about shadcn or any other host
// concern: by the time this component runs, "where and how" was already
// decided statically by trim.config.tsx. The one thing it genuinely cannot
// do ahead of a render — resolve each item's live value — is exactly what
// useTrimControlState is for.
//
// Implements exactly the TrimLayoutProps contract a fully custom `layout`
// component would (see ../config.ts) — this is simply Trim's own built-in
// implementation of it, nothing more privileged.
//
// The only export is DefaultSectionsLayout: the per-kind dispatch logic
// (renderResolvedControl) lives in ./render-resolved-control.tsx, an
// internal sibling with no export-map subpath of its own, specifically so
// importing @theharborproject/trim/react/layouts/sections — which points
// directly at this file, not through a curated barrel — exposes only the
// one symbol this subpath is meant to publish.
//
// Deliberately does NOT import react/panel.tsx's <Trim.Section>: that would
// make this new, granular layout depend on the legacy auto-discovery file —
// the wrong direction for this package's module graph. The small
// collapsible-section markup below is an intentional, direct duplication of
// <Trim.Section>'s own <details>/<summary> shape, not a second competing
// design — see panel.tsx's own <Trim.Section> for the sibling.

import { useId, type ReactNode } from "react";
import { useTrimControlState } from "../hooks";
import type { TrimLayoutProps, TrimResolvedGroup } from "../config";
import { renderResolvedControl } from "./render-resolved-control";
import type { TrimRegistry } from "../../core/registry";

function LayoutItem({ itemRef, component, registry }: {
  itemRef: string;
  component?: TrimResolvedGroup["items"][number]["component"];
  registry?: TrimRegistry;
}) {
  // Same rationale as panel.tsx's ControlWidget: a per-mount unique id keeps
  // two rendered instances of the SAME segmented control (is_unique: false)
  // from merging into one native radio group.
  const instanceId = useId();
  const { control, value, setValue } = useTrimControlState(itemRef, registry);
  if (!control) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`Trim: <Trim.Panel config={...}> — no control resolves to "${itemRef}".`);
    }
    return null;
  }
  return renderResolvedControl(control, value, setValue, `${instanceId}-${itemRef}`, component);
}

function GroupSection({ group, children }: { group: TrimResolvedGroup; children: ReactNode }) {
  if (!group.label) {
    return (
      <section data-trim-section>
        <div data-trim-section-body>{children}</div>
      </section>
    );
  }
  return (
    <details data-trim-section open={!group.collapsed}>
      <summary data-trim-section-title>{group.label}</summary>
      <div data-trim-section-body>{children}</div>
    </details>
  );
}

export function DefaultSectionsLayout({ groups, registry }: TrimLayoutProps) {
  return (
    <>
      {groups.map(group => (
        <GroupSection key={group.id} group={group}>
          {group.items.map((item, index) => (
            // Index in the key, not just item.ref: an is_unique: false
            // control can legitimately appear more than once in one group.
            <LayoutItem key={`${index}-${item.ref}`} itemRef={item.ref} component={item.component} registry={registry} />
          ))}
        </GroupSection>
      ))}
    </>
  );
}
