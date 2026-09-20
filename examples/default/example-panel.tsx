// The complete composition, using only the high-level public path:
// <Trim.Registry controls={...}> registers the manifest (via the internal
// manifest adapter, never touched directly here), and
// <Trim.Panel config={...}> renders it through Trim's default "sections"
// layout. No DefaultSectionsLayout import — <Trim.Panel config> already IS
// the intended high-level entry point for a config-driven panel; reaching
// past it for the default case would defeat the point of having it.
import { Trim } from "@theharborproject/trim/react";
import trimConfig from "./trim/trim.config";
import { trimControls } from "./trim/trim.manifest";
import "@theharborproject/trim/themes/default.css";

export function ExamplePanel() {
  return (
    <Trim.Registry controls={trimControls}>
      <Trim.Panel config={trimConfig} />
    </Trim.Registry>
  );
}
