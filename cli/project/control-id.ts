// Trim CLI — control id validation. The id becomes the declaration id, the
// *.trim.ts file basename, and (once trim.manifest.ts is regenerated) the
// manifest identity — one string, three uses, so it's validated once here
// rather than trusted at each call site.

const KEBAB_CASE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function isValidControlId(id: string): boolean {
  return KEBAB_CASE_ID.test(id);
}

/**
 * A plausible kebab-case rewrite, offered as a SUGGESTION only — never
 * applied automatically. "Reduced Motion" becoming "reduced-motion" is the
 * CLI's business to propose, not to silently decide on the user's behalf.
 */
export function suggestControlId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * "reduced-motion" -> "Reduced Motion": a plausible human-readable label
 * proposed FROM the id, offered as a starting point only — every wizard
 * that uses this (trim new control, trim attach's new-group label, trim
 * detect) shows it for the user to confirm or edit, never applies it
 * silently. Shared here rather than duplicated per-wizard.
 */
export function suggestControlLabel(id: string): string {
  return id
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
