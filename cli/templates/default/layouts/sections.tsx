// Installed by `trim add @default/layouts/sections`. Host-owned from this
// point on — edit the section markup, add classNames, sort groups, add a
// per-item wrapper, whatever your project needs.
//
// NOTE ON DESIGN: this is a small STANDALONE implementation, not a wrapper
// around @theharborproject/trim/react/layouts/sections's own
// DefaultSectionsLayout. That component takes only `{groups, registry}` —
// no className, no per-item render prop, no slot of any kind — so a
// one-line wrapper around it (`export function Layout(props) { return
// <DefaultSectionsLayout {...props} /> }`) would give you a file to own
// without anything in it you could actually change; the real per-kind
// dispatch logic is Trim's own internal implementation detail, not public.
// This file instead reimplements that same dispatch using ONLY Trim's
// public granular renderer exports, so every part of it — the section
// markup, the per-kind switch, the fallback — is genuinely yours to edit.
import { useId, type ReactNode, type ComponentType } from "react";
import { useTrimControlState } from "@theharborproject/trim/react";
import type { TrimLayoutProps, TrimResolvedGroup, TrimControlRendererProps } from "@theharborproject/trim/react";
import type { TrimControl } from "@theharborproject/trim";
import { DefaultBooleanControl } from "@theharborproject/trim/react/controls/boolean";
import { DefaultSegmentedControl } from "@theharborproject/trim/react/controls/segmented";
import { DefaultToggleActionControl } from "@theharborproject/trim/react/controls/toggle-action";
import { UnsupportedKindFallback } from "@theharborproject/trim/react/controls/unsupported-fallback";

type ResolvedItem = TrimResolvedGroup["items"][number];

function renderItem(control: TrimControl, value: unknown, setValue: (value: unknown) => void, groupName: string, component: ResolvedItem["component"]): ReactNode {
  if (component) {
    const Component = component as ComponentType<TrimControlRendererProps<any>>;
    return <Component control={control} value={value} setValue={setValue} />;
  }
  switch (control.kind) {
    case "toggle":
      return <DefaultBooleanControl control={control as TrimControl<boolean>} value={value as boolean | undefined} setValue={setValue as (v: boolean) => void} />;
    case "segmented":
      return <DefaultSegmentedControl groupName={groupName} control={control as TrimControl<string>} value={value as string | undefined} setValue={setValue as (v: string) => void} />;
    case "toggle-action":
      return <DefaultToggleActionControl control={control as TrimControl<boolean>} value={value as boolean | undefined} setValue={setValue as (v: boolean) => void} />;
    default:
      return <UnsupportedKindFallback control={control} />;
  }
}

function LayoutItem({ item, registry }: { item: ResolvedItem; registry: TrimLayoutProps["registry"] }) {
  // A per-mount unique id keeps two rendered instances of the SAME
  // segmented control (is_unique: false) from merging into one native
  // radio group — see @theharborproject/trim/react/controls/segmented's
  // own DefaultSegmentedControlProps.groupName doc.
  const instanceId = useId();
  const { control, value, setValue } = useTrimControlState(item.ref, registry);
  if (!control) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`Layout: no control resolves to "${item.ref}".`);
    }
    return null;
  }
  return renderItem(control, value, setValue as (value: unknown) => void, `${instanceId}-${item.ref}`, item.component);
}

function GroupSection({ group, children }: { group: TrimResolvedGroup; children: ReactNode }) {
  if (!group.label) return <section>{children}</section>;
  return (
    <details open={!group.collapsed}>
      <summary>{group.label}</summary>
      <div>{children}</div>
    </details>
  );
}

export function SectionsLayout({ groups, registry }: TrimLayoutProps) {
  return (
    <>
      {groups.map(group => (
        <GroupSection key={group.id} group={group}>
          {group.items.map((item, index) => (
            // Index in the key, not just item.ref: an is_unique: false
            // control can legitimately appear more than once in one group.
            <LayoutItem key={`${index}-${item.ref}`} item={item} registry={registry} />
          ))}
        </GroupSection>
      ))}
    </>
  );
}
