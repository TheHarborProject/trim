"use client";

// shadcn adapter + popover shell, Base UI primitive backend — the
// `trim init` run against integrations/shadcn-base/ (its own real
// components.json with "style": "base-vega" + local
// components/ui/{button,popover}.tsx using Base UI's `render`-prop
// composition contract). Proves the SAME <TrimShell/> generator picks a
// structurally different (asChild-free) composition when the detected
// backend is Base UI instead of Radix — see this project's root-level
// ShadcnDemo.tsx for the Radix side of the same comparison.
import { useMemo } from "react";
import { createTrimRegistry } from "@theharborproject/trim";
import { Trim } from "@theharborproject/trim/react";
import { TrimShell } from "../integrations/shadcn-base/trim/TrimShell";
import { trimControls } from "../integrations/shadcn-base/trim/trim.manifest";

export function ShadcnBaseDemo() {
  const registry = useMemo(() => createTrimRegistry(), []);
  return (
    <Trim.Registry registry={registry} controls={trimControls}>
      <TrimShell />
    </Trim.Registry>
  );
}
