"use client";

// Vanilla adapter + popover shell — rendered globally from app/layout.tsx
// (a Server Component) on every page. A dedicated, per-mount registry (see
// this file's own header note on why) keeps this instance's "example"
// control isolated from the /shadcn and /headless demos' own instances,
// which each seed a control with the SAME id ("example") from a separate
// `trim init` run — real, independent Trim setups, not three views onto
// one shared registry.
import { useMemo } from "react";
import { createTrimRegistry } from "@theharborproject/trim";
import { Trim } from "@theharborproject/trim/react";
import trimConfig from "../integrations/vanilla/trim/trim.config";
import { trimControls } from "../integrations/vanilla/trim/trim.manifest";

export function VanillaGlobalPanel() {
  const registry = useMemo(() => createTrimRegistry(), []);
  return (
    <Trim.Registry registry={registry} controls={trimControls}>
      <Trim.Panel config={trimConfig} />
    </Trim.Registry>
  );
}
