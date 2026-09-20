// A custom renderer override for the "contrast" control (see
// ../trim.config.tsx's `{ id: "contrast", component: CustomContrast }`).
//
// Imports ONLY the public TrimControlRendererProps contract — no registry,
// no binding resolution, no manifest or Trim internals of any kind. Trim
// resolves control/value/setValue and hands them here already-live; this
// file only renders them.
import type { TrimControlRendererProps } from "@theharborproject/trim/react";

export function CustomContrast({ control, value, setValue }: TrimControlRendererProps<boolean>) {
  return (
    <button type="button" aria-pressed={Boolean(value)} onClick={() => setValue(!value)}>
      {control.label}: {value ? "High" : "Normal"}
    </button>
  );
}
