// Installed by `trim add @default/controls/toggle-action`. Host-owned from
// this point on. Wraps Trim's own default toggle-action (WAI-ARIA "toggle
// button" pattern) renderer so you have a starting point already wired to a
// `trim.config.tsx` `component` override; edit the markup freely.
import { DefaultToggleActionControl } from "@theharborproject/trim/react/controls/toggle-action";
import type { TrimControlRendererProps } from "@theharborproject/trim/react";

export function ToggleActionControl(props: TrimControlRendererProps<boolean>) {
  return <DefaultToggleActionControl {...props} />;
}
