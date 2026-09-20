"use client";

// @theharborproject/trim/react — the common React path. Combines the
// declarative JSX primitives (components.tsx), the default renderer
// (panel.tsx), the headless hooks, and the hook-enabled controller into one
// entry point. Every real export here originates in a file that itself
// needs "use client" (a hook, an event handler, or createContext) — see
// EXTRACTION.md's audit in the source repo for the file-by-file reasoning —
// so marking this entry point itself costs nothing and makes the boundary
// obvious to any tool that only looks at the entry file.

import { Registry, Integration, Toggle, Segmented, Option, ToggleAction } from "./components";
import { Panel, Section, Control } from "./panel";

export { Registry, Integration, Toggle, Segmented, Option, ToggleAction };
export type { ToggleProps, SegmentedProps, ToggleActionProps, OptionProps, RegistryProps, IntegrationProps } from "./components";

export { Panel, Section, Control };
export type { PanelProps, SectionProps, ControlProps } from "./panel";

/** The full set of JSX primitives under one namespace — Trim.Registry, Trim.Integration, Trim.Toggle, Trim.Segmented, Trim.Option, Trim.ToggleAction, Trim.Panel, Trim.Section, Trim.Control. */
export const Trim = { Registry, Integration, Toggle, Segmented, Option, ToggleAction, Panel, Section, Control };

export { useTrimRegistry, useTrimIntegration, useTrimControl, useTrimControlState, type TrimControlState } from "./hooks";

export { defaultTrimRegistry, TrimRegistryContext } from "./registry-context";

export { createTrimController, type TrimController, type TrimControllerOptions } from "./controller";
