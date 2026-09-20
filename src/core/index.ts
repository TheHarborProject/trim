// @theharborproject/trim — root entry. 100% framework-agnostic: no React
// import anywhere in this file's dependency graph, no "use client". Usable
// from a Server Component, a non-React framework, or a plain Node script.
//
// For the React-hook layer (createTrimController's useSettings(), the JSX
// declaration primitives, the default panel renderer, the headless hooks),
// see "@theharborproject/trim/react". For low-level primitives meant for a
// custom renderer or non-default integration, see
// "@theharborproject/trim/advanced".

export type { TrimOptionsSchema, TrimSettings, TrimState, MotionValue, MotionConfig, MotionResolver } from "../types";

export {
  normalizeSettings, effectiveMotion, readStoredSettings, writeStoredSettings,
  clearStoredSettings, initializeTrim, createInitScript,
} from "./settings";

export { createTrimRegistry, type TrimRegistry } from "./registry";

export type {
  TrimCore, TrimControl, TrimControlKind, TrimIntegrationMeta,
  ToggleControl, SegmentedControl, SegmentedOption, SliderControl, ActionControl, ToggleActionControl, CustomControl,
} from "./integration";

export { controller, callback, type TrimBinding } from "./bindings";

export { createTrimController, type TrimController, type TrimControllerOptions } from "./controller";
