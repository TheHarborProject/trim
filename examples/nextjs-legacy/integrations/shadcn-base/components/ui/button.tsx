// Minimal local shadcn-style Button primitive (Base UI backend flavor) —
// this fixture's own file, never imported from @theharborproject/trim.
// Hand-installed rather than pulled from shadcn's CLI (no network
// dependency on registry hosts for this repo's own fixture), but a real,
// ordinary React component matching the shape a generated Base UI
// <TrimShell/> expects: `variant`, plus every prop PopoverTrigger's
// `render` composition forwards onto it (onClick, aria-*, id, ref, ...) —
// see ../../../../../cli/templates/shadcn/shell/popover-base.tsx and this
// project's own components/ui/popover.tsx.
//
// Deliberately NO `asChild` prop anywhere — Base UI never merges props onto
// a child the way Radix's Slot does; composition instead happens on the
// TRIGGER side via its own `render` prop (see popover.tsx), so Button here
// only ever renders its own single <button>.
"use client";

import * as React from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline";
};

const VARIANT_CLASS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "trim-fixture-button trim-fixture-button--default",
  outline: "trim-fixture-button trim-fixture-button--outline",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "default", className, children, ...props }, ref) {
  const classes = [VARIANT_CLASS[variant], className].filter(Boolean).join(" ");
  return (
    <button ref={ref} className={classes} {...props}>
      {children}
    </button>
  );
});
