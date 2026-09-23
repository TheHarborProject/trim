// Trim CLI — trim/trim.settings.ts generation. The ONE place that knows
// what this file looks like, for both `trim init` (writes the empty
// placeholder) and `trim new control` (regenerates it with a real schema).
//
// trim.settings.ts is 100% CLI-generated and never hand-edited, so its
// exact shape is fully under our control — which is what makes safe
// regeneration possible without a second, hidden metadata file: this
// module embeds the small machine-readable representation
// (`@trim-managed-schema`) AS A COMMENT INSIDE the very file it describes,
// not as a separate file that could drift out of sync. `new control`
// parses that one line back with plain JSON.parse (never a fragile
// string-replacement patch, and never a general TS/AST parse of the real
// code below it), appends the new control's setting, and regenerates the
// WHOLE file — both the comment and the real code — in one deterministic
// pass. There is exactly one obvious source of truth: this file's own
// content.
//
// The embedded payload is itself versioned:
// `{"version":1,"settings":[...]}`, not a bare array — so a future format
// change has somewhere to declare itself. A `version` that IS present but
// isn't one this CLI understands fails loudly (see below); it is never
// guessed at or silently migrated.

import { controlIdToIdentifier } from "./manifest-file";
import { UsageError } from "../dispatch";

export type TrimManagedSetting =
  | { key: string; kind: "boolean"; defaultValue: boolean }
  | { key: string; kind: "segmented"; options: readonly string[]; defaultValue: string };

const SCHEMA_MARKER = "// @trim-managed-schema ";
const CURRENT_SCHEMA_VERSION = 1;

/**
 * Fails CLOSED, not open: the only case that returns `[]` is the marker
 * being genuinely absent (a project that never had any Trim-managed
 * control). Anything that looks like an ATTEMPT at the marker — present,
 * but malformed JSON, an unrecognized object shape, an unsupported
 * version, or the old pre-versioning bare-array format this briefly had
 * before hardening — throws instead of silently returning an empty list.
 * Silently emptying a real, if malformed, schema would be actively
 * dangerous: a later `trim new control` regenerating trim.settings.ts from
 * an incorrectly-"empty" read would DISCARD every existing Trim-managed
 * control's schema, not just fail to add the new one.
 */
export function parseExistingManagedSettings(source: string): readonly TrimManagedSetting[] {
  const line = source.split("\n").find((l) => l.startsWith(SCHEMA_MARKER));
  if (!line) return []; // rule 1: no marker at all

  const raw = line.slice(SCHEMA_MARKER.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // rule 3: malformed JSON
    throw new UsageError(
      "trim/trim.settings.ts's embedded @trim-managed-schema marker is not valid JSON. " +
        "This file is machine-generated and should never be hand-edited — resolve it by hand before retrying; it is never guessed at or silently discarded.",
    );
  }

  if (Array.isArray(parsed)) {
    // rule 6: the old, unversioned bare-array shape this format briefly had
    // before hardening — never shipped to a real project, but explicitly
    // unsupported now, not silently treated as an empty schema.
    throw new UsageError(
      "trim/trim.settings.ts's embedded schema uses the old, unversioned format (a bare array), which is no longer supported. " +
        "Resolve trim.settings.ts by hand before retrying — an unrecognized format is never guessed at or auto-migrated.",
    );
  }

  if (parsed === null || typeof parsed !== "object" || !("version" in parsed) || !("settings" in parsed) || !Array.isArray((parsed as { settings: unknown }).settings)) {
    // rule 4: present, valid JSON, but not the expected {version, settings} shape
    throw new UsageError(
      'trim/trim.settings.ts\'s embedded @trim-managed-schema marker does not have the expected {"version": ..., "settings": [...]} shape. ' +
        "Resolve it by hand before retrying.",
    );
  }

  const { version, settings } = parsed as { version: unknown; settings: TrimManagedSetting[] };
  if (version !== CURRENT_SCHEMA_VERSION) {
    // rule 5: a recognizable but unsupported version
    throw new UsageError(
      `trim/trim.settings.ts's embedded schema is version ${JSON.stringify(version)}, but this CLI only supports version ${CURRENT_SCHEMA_VERSION}. ` +
        "Resolve trim.settings.ts by hand, or use a matching Trim CLI version — an unsupported version is never guessed at or auto-migrated.",
    );
  }

  return settings; // rule 2: the valid case
}

function schemaKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function schemaEntry(setting: TrimManagedSetting): string {
  return setting.kind === "boolean" ? `    ${schemaKey(setting.key)}: ["true", "false"],` : `    ${schemaKey(setting.key)}: [${setting.options.map((o) => JSON.stringify(o)).join(", ")}],`;
}

function defaultEntry(setting: TrimManagedSetting): string {
  return setting.kind === "boolean" ? `    ${schemaKey(setting.key)}: ${JSON.stringify(setting.defaultValue ? "true" : "false")},` : `    ${schemaKey(setting.key)}: ${JSON.stringify(setting.defaultValue)},`;
}

/**
 * A boolean Trim-managed setting is backed by a two-value STRING schema
 * ("true"/"false") under the hood, since createTrimController's schema is
 * string-enum only (TrimOptionsSchema = Record<string, readonly string[]>
 * — see @theharborproject/trim's core types); this wraps that with the
 * public callback() so the exported binding is a genuine
 * TrimBinding<boolean>. The coercion lives entirely here, built from
 * public callback()/controller() — never a package-internal mechanism.
 */
function bindingEntry(setting: TrimManagedSetting): string {
  if (setting.kind === "segmented") {
    return `  ${controlIdToIdentifier(setting.key)}: controller(trimSettingsController, "${setting.key}"),`;
  }
  return (
    `  ${controlIdToIdentifier(setting.key)}: callback<boolean>(\n` +
    `    () => controller(trimSettingsController, "${setting.key}").get() === "true",\n` +
    `    (value) => controller(trimSettingsController, "${setting.key}").set(value ? "true" : "false"),\n` +
    `    (listener) => controller(trimSettingsController, "${setting.key}").subscribe((value) => listener(value === "true")),\n` +
    `  ),`
  );
}

/** Deterministic regardless of call/add order — see settings.length===0 branch's own comment for why an empty schema never instantiates a controller. */
export function generateSettingsFileContents(settings: readonly TrimManagedSetting[]): string {
  if (settings.length === 0) {
    return `// Generated by Trim. Updated by the Trim CLI.
// @trim-managed-schema {"version":${CURRENT_SCHEMA_VERSION},"settings":[]}
//
// Host-owned settings controller for Trim-managed controls, built from
// @theharborproject/trim's public createTrimController()/controller().
// Empty for now — no Trim-managed control exists yet. Once you run
// \`trim new control <id>\` and choose "Trim-managed" state, the CLI
// regenerates this file with a real schema and a \`trimSettings.<key>\`
// binding for that control's *.trim.ts file to import.
//
// Deliberately not calling createTrimController() with an empty schema
// here: that would instantiate a whole settings engine (MutationObserver,
// a data-trim-state attribute, localStorage persistence) for zero actual
// settings, just to have something to point at — a placeholder pretending
// to be working code. This file stays honestly empty until it has a real
// schema to hold.
export {};
`;
  }

  // Lexical key order: deterministic regardless of which control was added
  // in which command invocation — see cli/generators/manifest-file.ts's
  // matching choice for the same reasoning.
  const sorted = [...settings].sort((a, b) => a.key.localeCompare(b.key));

  return `// Generated by Trim. Updated by the Trim CLI — do not hand-edit; \`trim new
// control\` regenerates this file whenever a Trim-managed control's schema
// changes. Entries are kept in lexical key order.
// @trim-managed-schema ${JSON.stringify({ version: CURRENT_SCHEMA_VERSION, settings: sorted })}
//
// One shared controller for every Trim-managed control — never one per
// *.trim.ts file. A boolean Trim-managed setting is backed by a two-value
// string schema under the hood; see bindingEntry's comment in this
// generator for why, and note it changes nothing about this file's own
// public shape: trimSettings.<key> is always a genuine TrimBinding of the
// control's real value type.
import { createTrimController, controller, callback } from "@theharborproject/trim";

const trimSettingsController = createTrimController(
  {
${sorted.map(schemaEntry).join("\n")}
  },
  {
${sorted.map(defaultEntry).join("\n")}
  },
  "trim-settings",
);

export const trimSettings = {
${sorted.map(bindingEntry).join("\n")}
};
`;
}
