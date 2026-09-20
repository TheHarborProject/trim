// Trim — pure ordering/grouping over registered integrations. No React
// import: @theharborproject/trim/react's default <Trim.Panel> (panel.tsx)
// uses these for its automatic layout; a custom renderer can use them the
// same way without pulling in anything React-only.

import type { TrimCore } from "../core/integration";

export function sortByOrder(items: readonly TrimCore[]): TrimCore[] {
  return items
    .map((item, index) => ({ item, key: item.meta.order ?? index }))
    .sort((a, b) => a.key - b.key)
    .map(entry => entry.item);
}

export function groupInOrder(items: readonly TrimCore[]): { group: string | undefined; integrations: TrimCore[] }[] {
  const ordered = sortByOrder(items);
  const groups = new Map<string | undefined, TrimCore[]>();
  for (const integration of ordered) {
    const key = integration.meta.group;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(integration);
  }
  return Array.from(groups.entries()).map(([group, integrations]) => ({ group, integrations }));
}
