// Minimal local shadcn-style Button primitive — this fixture's own file,
// never imported from @theharborproject/trim. Hand-installed rather than
// pulled from shadcn's CLI (no network dependency on registry hosts for
// this repo's own fixture), but a real, ordinary React component matching
// the shape a generated <TrimShell/> expects: `variant` + `asChild`.
"use client";

import * as React from "react";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline";
  asChild?: boolean;
};

const VARIANT_CLASS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "trim-fixture-button trim-fixture-button--default",
  outline: "trim-fixture-button trim-fixture-button--outline",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", asChild, className, children, ...props },
  ref,
) {
  const classes = [VARIANT_CLASS[variant], className].filter(Boolean).join(" ");

  // A tiny stand-in for @radix-ui/react-slot's asChild: when asChild is set
  // and the single child is a real element, merge our props/ref onto it
  // instead of rendering our own <button> — same contract shadcn's real
  // Button relies on for <PopoverTrigger asChild><Button/></PopoverTrigger>.
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<Record<string, unknown>>;
    return React.cloneElement(child, {
      ...props,
      className: [classes, (child.props as { className?: string }).className].filter(Boolean).join(" "),
      ref,
    });
  }

  return (
    <button ref={ref} className={classes} {...props}>
      {children}
    </button>
  );
});
