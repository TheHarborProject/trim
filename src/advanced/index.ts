// @theharborproject/trim/advanced — low-level primitives for a custom
// renderer or a non-default integration. Organized by audience (power-user),
// not by client/server boundary: resolution.ts and sorting.ts import no
// React at all and need no "use client" of their own; widgets.tsx does, for
// the real event handlers it attaches (see its own header comment). No
// directive on this barrel itself — each file below carries its own,
// correctly, and a re-export barrel doesn't need to restate one a consumer
// only importing the React-free half would otherwise be forced into.
//
// Deliberately NOT exposed here: buildIntegrationDescriptor and the other
// JSX-tree-parsing internals of @theharborproject/trim/react's
// components.tsx — those are internal implementation detail, reachable only
// by this package's own tests importing the source file directly, never
// part of any public entry point.

export { resolveControlRef, trimControlRef, findIntegration, findControl, controlSnapshot, subscribeToControl } from "./resolution";
export { sortByOrder, groupInOrder } from "./sorting";
export { ToggleWidget, SegmentedWidget, ToggleActionWidget, UnsupportedKindFallback } from "./widgets";
