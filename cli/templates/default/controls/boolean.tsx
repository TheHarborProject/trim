// Installed by `trim add @default/controls/boolean`. Host-owned from this
// point on — Trim never touches this file again. Wraps Trim's own default
// boolean renderer so you have a starting point already wired to a
// `trim.config.tsx` `component` override; edit the markup freely.
import { DefaultBooleanControl } from "@theharborproject/trim/react/controls/boolean";
import type { TrimControlRendererProps } from "@theharborproject/trim/react";

export function BooleanControl(props: TrimControlRendererProps<boolean>) {
  return <DefaultBooleanControl {...props} />;
}
