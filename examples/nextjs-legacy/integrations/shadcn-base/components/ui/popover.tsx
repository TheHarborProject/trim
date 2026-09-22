// Minimal local shadcn-style Popover primitive (Base UI backend flavor) —
// this fixture's own file, never imported from @theharborproject/trim. Same
// public shape as shadcn's real Base UI-backed Popover (itself a thin
// wrapper over @base-ui-components/react's Popover): a context-based
// <Popover>/<PopoverTrigger render={...}>/<PopoverContent>, open state owned
// internally (uncontrolled), dismissible via Escape or an outside click —
// enough to genuinely exercise a real disclosure widget end to end without
// pulling in Base UI for this fixture.
//
// The one genuinely load-bearing difference from this project's root-level
// (Radix) components/ui/popover.tsx: PopoverTrigger composes via a `render`
// prop, NEVER `asChild` — it clones the element passed as `render`, merging
// its own trigger props onto it and replacing that element's children with
// ITS OWN children, so there is exactly one interactive element in the
// rendered DOM (never a <button> nested inside another, and never an
// `aschild`-lookalike attribute leaking onto the DOM node).
//
// Deliberately namespaced "data-fixture-*", never "data-trim-shell-*" —
// those attributes are Trim's OWN vanilla-shell vocabulary (see
// src/react/shell/vanilla-popover.tsx); this component has nothing to do
// with Trim and must not be mistaken for its chrome.
"use client";

import * as React from "react";

type PopoverContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerId: string;
};

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

export function Popover({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const triggerId = React.useId();
  return <PopoverContext.Provider value={{ open, setOpen, triggerId }}>{children}</PopoverContext.Provider>;
}

function usePopoverContext(componentName: string): PopoverContextValue {
  const ctx = React.useContext(PopoverContext);
  if (!ctx) throw new Error(`<${componentName}> must be used inside <Popover>`);
  return ctx;
}

export type PopoverTriggerProps = {
  /** The element PopoverTrigger renders AS — Base UI's real composition contract: takes a JSX element directly, never a render function. */
  render?: React.ReactElement<Record<string, unknown>>;
  children?: React.ReactNode;
};

export function PopoverTrigger({ render, children }: PopoverTriggerProps) {
  const { open, setOpen, triggerId } = usePopoverContext("PopoverTrigger");

  const sharedProps: Record<string, unknown> = {
    id: triggerId,
    "aria-haspopup": "dialog",
    "aria-expanded": open,
    "data-fixture-popover-trigger": "",
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      const renderOnClick = render?.props.onClick as ((e: React.MouseEvent<HTMLButtonElement>) => void) | undefined;
      renderOnClick?.(event);
      setOpen(!open);
    },
  };

  // No nested interactive element, ever: `render`'s own children are
  // REPLACED by ours (Base UI's real contract — the trigger's children
  // become the rendered element's content), never wrapped around it.
  if (render && React.isValidElement(render)) {
    return React.cloneElement(render, sharedProps, children);
  }

  return (
    <button {...sharedProps}>{children}</button>
  );
}

export function PopoverContent({
  align = "center",
  children,
}: {
  align?: "start" | "center" | "end";
  children?: React.ReactNode;
}) {
  const { open, setOpen, triggerId } = usePopoverContext("PopoverContent");
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      const trigger = document.getElementById(triggerId);
      if (contentRef.current && !contentRef.current.contains(target) && !(trigger && trigger.contains(target))) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open, setOpen, triggerId]);

  if (!open) return null;

  return (
    <div ref={contentRef} role="dialog" aria-labelledby={triggerId} data-fixture-popover-content="" data-align={align} className="trim-fixture-popover-content">
      {children}
    </div>
  );
}
