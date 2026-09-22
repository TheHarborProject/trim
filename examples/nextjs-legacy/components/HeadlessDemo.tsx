"use client";

// headless adapter — no shell concept, no generated wrapper file (see
// cli/generators/init-files.ts's header): the host imports <Panel> directly.
// `ui.adapter: "headless"` resolves to a zero-wrapper passthrough at
// runtime (src/react/shell/resolve.ts) — nothing here should render any
// launcher/popover chrome at all.
import { useMemo } from "react";
import { createTrimRegistry } from "@theharborproject/trim";
import { Trim } from "@theharborproject/trim/react";
import trimConfig from "../integrations/headless/trim/trim.config";
import { trimControls } from "../integrations/headless/trim/trim.manifest";

export function HeadlessDemo() {
  const registry = useMemo(() => createTrimRegistry(), []);
  return (
    <div data-fixture-headless-host>
      <p>
        Headless adapter: Trim renders no launcher, no popover, no built-in chrome at all — just
        the panel&apos;s DOM (data-trim-panel/data-trim-control/etc.) for this host to style and
        position itself.
      </p>
      <Trim.Registry registry={registry} controls={trimControls}>
        <Trim.Panel config={trimConfig} />
      </Trim.Registry>
    </div>
  );
}
