"use client";

// shadcn adapter + popover shell — the ROOT-level `trim init` run's output
// (trim/, right at this fixture's project root, since a real shadcn setup's
// components.json/tsconfig `paths` are read from the project root, and
// TrimShell.tsx's generated "@/components/ui/..." imports must resolve the
// exact same way Next's own bundler resolves them). See this file's sibling
// VanillaGlobalPanel.tsx for why this gets its own registry instance.
import { useMemo } from "react";
import { createTrimRegistry } from "@theharborproject/trim";
import { Trim } from "@theharborproject/trim/react";
import { TrimShell } from "../trim/TrimShell";
import { trimControls } from "../trim/trim.manifest";

export function ShadcnDemo() {
  const registry = useMemo(() => createTrimRegistry(), []);
  return (
    <Trim.Registry registry={registry} controls={trimControls}>
      <TrimShell />
    </Trim.Registry>
  );
}
