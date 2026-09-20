// Trim — shared types. Framework-agnostic: no React import. Used by every
// entry point (core, react, advanced) — this is the one file all three
// depend on, so it lives at the src root rather than inside any of them.

export type TrimOptionsSchema = Record<string, readonly string[]>;
export type TrimSettings<Schema extends TrimOptionsSchema> = { [K in keyof Schema]: Schema[K][number] };

export type MotionValue = "full" | "reduced" | "none";

export type TrimState<Schema extends TrimOptionsSchema> = {
  settings: TrimSettings<Schema>;
  // Only present when the controller was given a `motion` config (see
  // createTrimController) — a schema with no motion-floor concept at all
  // simply never has this field, rather than being forced to carry one.
  motion?: MotionValue;
  systemReduced: boolean;
};

// The motion floor is opt-in, not assumed. Shared here (not in core/settings.ts
// or the controller files specifically) so all of them can reference the same
// shape without the framework-agnostic files importing anything React-shaped.
/** Computes the exposed data-{prefix}-motion value from the validated raw field value and whether the system prefers reduced motion. */
export type MotionResolver = (rawValue: string, systemReduced: boolean) => MotionValue;

export type MotionConfig<Schema extends TrimOptionsSchema> = {
  /** Which schema field carries the raw motion preference (e.g. "animations"). Its values are plain schema strings — not required to be "full"/"reduced"/"none" themselves, only what `resolve` maps them to matters. */
  key: keyof Schema & string;
  /** Default: a stored/proposed "full" never overrides the system's reduced-motion request — `systemReduced && rawValue === "full" ? "reduced" : rawValue`. Only honored by createTrimController — createInitScript's prepaint script always uses the default (a custom function cannot survive being serialized into a <script> tag). */
  resolve?: MotionResolver;
};
