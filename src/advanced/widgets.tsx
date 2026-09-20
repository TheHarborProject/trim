"use client";

// Trim — compatibility re-exports. The actual implementations moved to
// ../react/controls/*.tsx (granular, individually importable/tree-shakable —
// see that directory's own files and the package's export map). These
// names and signatures are kept exactly as they were: an existing
// `import { ToggleWidget } from "@theharborproject/trim/advanced"` call site
// needs no change. Nothing here is a second implementation — each export is
// a one-line forward to its ../react/controls/* counterpart, so there is
// never a place where the two could drift out of sync.

import type { TrimControl } from "../core/integration";
import { DefaultBooleanControl } from "../react/controls/boolean";
import { DefaultSegmentedControl } from "../react/controls/segmented";
import { DefaultToggleActionControl } from "../react/controls/toggle-action";

export { UnsupportedKindFallback } from "../react/controls/unsupported-fallback";

export function ToggleWidget(props: { control: TrimControl<boolean>; value: boolean | undefined; setValue: (v: boolean) => void }) {
  return <DefaultBooleanControl {...props} />;
}

export function SegmentedWidget(props: { groupName: string; control: TrimControl<string>; value: string | undefined; setValue: (v: string) => void }) {
  return <DefaultSegmentedControl {...props} />;
}

export function ToggleActionWidget(props: { control: TrimControl<boolean>; value: boolean | undefined; setValue: (v: boolean) => void }) {
  return <DefaultToggleActionControl {...props} />;
}
