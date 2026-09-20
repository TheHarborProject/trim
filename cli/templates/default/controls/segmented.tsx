// Installed by `trim add @default/controls/segmented`. Host-owned from this
// point on. `groupName` sits outside TrimControlRendererProps in the
// underlying default renderer (see @theharborproject/trim's own
// DefaultSegmentedControlProps) — a per-mount-unique name keeps two
// rendered instances of the SAME control (is_unique: false) from merging
// into one native radio group; a renderer that only ever renders once may
// pass the control's own id.
import { DefaultSegmentedControl, type DefaultSegmentedControlProps } from "@theharborproject/trim/react/controls/segmented";

export function SegmentedControl(props: DefaultSegmentedControlProps) {
  return <DefaultSegmentedControl {...props} />;
}
