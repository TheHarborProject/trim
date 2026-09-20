"use client";

// Installed by `trim add @shadcn/controls/boolean`. Host-owned from this
// point on. Uses your project's own shadcn Switch component (see
// components.json's "ui" alias) — Trim's runtime has no idea this file
// exists or that shadcn is involved; it only ever sees the public
// TrimControlRendererProps contract this implements.
import { useId } from "react";
import { Switch } from "__TRIM_SHADCN_UI_IMPORT__/switch";
import type { TrimControlRendererProps } from "@theharborproject/trim/react";

export function ShadcnBooleanControl({ control, value, setValue }: TrimControlRendererProps<boolean>) {
  const id = useId();
  const descriptionId = control.description ? `${id}-description` : undefined;
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id}>{control.label}</label>
        {control.description ? (
          <p id={descriptionId} className="text-sm text-muted-foreground">
            {control.description}
          </p>
        ) : null}
      </div>
      <Switch id={id} checked={Boolean(value)} onCheckedChange={setValue} aria-describedby={descriptionId} />
    </div>
  );
}
