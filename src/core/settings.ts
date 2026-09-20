// Trim — settings engine: schema validation, prepaint init script,
// localStorage persistence. Framework-agnostic: no React, no "use client".

import type { TrimOptionsSchema, TrimSettings, MotionValue } from "../types";

/** Validates `value` against `schema`, falling back to `defaults` key by key. */
export function normalizeSettings<Schema extends TrimOptionsSchema>(
  schema: Schema,
  defaults: TrimSettings<Schema>,
  value: unknown,
): TrimSettings<Schema> {
  const result = { ...defaults };
  if (typeof value !== "object" || value === null || Array.isArray(value)) return result;
  for (const key of Object.keys(schema) as (keyof Schema)[]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const candidate = (value as Record<string, unknown>)[key as string];
    if (typeof candidate === "string" && (schema[key] as readonly string[]).includes(candidate)) {
      (result as Record<string, unknown>)[key as string] = candidate;
    }
  }
  return result;
}

/** A stored "full" motion preference never overrides the system's reduced-motion request. */
export function effectiveMotion(motion: MotionValue, systemReduced: boolean): MotionValue {
  return systemReduced && motion === "full" ? "reduced" : motion;
}

/** Non-fatal: this visit falls back to `defaults` when storage is blocked, malformed or empty. */
export function readStoredSettings<Schema extends TrimOptionsSchema>(
  schema: Schema,
  defaults: TrimSettings<Schema>,
  storageKey: string,
): TrimSettings<Schema> {
  let stored: unknown = null;
  try { stored = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch { /* Use defaults. */ }
  return normalizeSettings(schema, defaults, stored);
}

export function writeStoredSettings<Schema extends TrimOptionsSchema>(storageKey: string, settings: TrimSettings<Schema>): void {
  try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch { /* Applies for this visit only. */ }
}

export function clearStoredSettings(storageKey: string): void {
  try { localStorage.removeItem(storageKey); } catch { /* Storage may be unavailable. */ }
}

// Self-contained, serialized into <head>: preferences apply before the first
// paint. Only validated values are written to attributes; storage denial is
// non-fatal. The motion floor is opt-in — `motionKey` is the schema field
// name, or null for a schema with no motion concept at all — matching
// createTrimController's own `motion` option. Still writes a `data-oa-*`
// attribute prefix unconditionally: this exact function is what ONE:ACCESS's
// prepaint script has always been, byte-for-byte (see the host's own
// lib/oa-tools.ts) — a real, host-owned attribute prefix is a call-site
// concern for a future version of this function, not addressed here.
// Exported (not just used by createInitScript) so a host that wants to
// reuse the exact prepaint mechanism under its own name still can.
//
// `motionKey` is a plain string (not a full MotionConfig with `resolve`):
// this function is serialized via .toString() into a standalone <script>
// tag, so it cannot close over an outside function — a custom `resolve`
// only makes sense for createTrimController, which runs as normal JS with
// working closures. The prepaint script always uses the same default floor:
// "a stored/proposed 'full' never overrides the system's reduced-motion
// request".
export function initializeTrim(options: TrimOptionsSchema, defaults: Record<string, string>, key: string, motionKey: string | null) {
  const root = document.documentElement;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const settings = Object.assign({}, defaults);
  if (motionKey) settings[motionKey] = reduced ? "reduced" : "full";
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const name of Object.keys(options)) {
        if ((options[name] as readonly unknown[]).includes(stored[name])) settings[name] = stored[name];
      }
    }
  } catch { /* Defaults remain usable when storage is blocked or malformed. */ }
  for (const [name, value] of Object.entries(settings)) root.setAttribute(`data-oa-${name.toLowerCase()}`, value);
  if (motionKey) {
    const raw = settings[motionKey];
    const motion = reduced && raw === "full" ? "reduced" : raw;
    root.setAttribute("data-oa-motion", motion);
    root.setAttribute("data-oa-state", JSON.stringify({ settings, motion, systemReduced: reduced }));
  } else {
    root.setAttribute("data-oa-state", JSON.stringify({ settings, systemReduced: reduced }));
  }
}

/** Builds a prepaint init script for any schema. `motionKey` is optional — omit it for a schema with no motion-floor concept. */
export function createInitScript<Schema extends TrimOptionsSchema>(
  options: Schema,
  defaults: TrimSettings<Schema>,
  storageKey: string,
  motionKey?: keyof Schema & string,
): string {
  return `(${initializeTrim.toString()})(${JSON.stringify(options)},${JSON.stringify(defaults)},${JSON.stringify(storageKey)},${JSON.stringify(motionKey ?? null)});`;
}
