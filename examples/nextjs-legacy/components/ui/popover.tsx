// Minimal local shadcn-style Popover primitive — this fixture's own file,
// never imported from @theharborproject/trim. Same public shape as shadcn's
// real Popover (itself a thin wrapper over @radix-ui/react-popover): a
// context-based <Popover>/<PopoverTrigger asChild>/<PopoverContent>, open
// state owned internally (uncontrolled), dismissible via Escape or an
// outside click — enough to genuinely exercise a real disclosure widget end
// to end without pulling in Radix for this fixture.
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

export type PopoverTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean };

export const PopoverTrigger = React.forwardRef<HTMLButtonElement, PopoverTriggerProps>(function PopoverTrigger(
  { asChild, children, onClick, ...rest },
  ref,
) {
  const { open, setOpen, triggerId } = usePopoverContext("PopoverTrigger");

  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    onClick?.(event);
    setOpen(!open);
  };

  const sharedProps = {
    id: triggerId,
    "aria-haspopup": "dialog" as const,
    "aria-expanded": open,
    "data-fixture-popover-trigger": "",
    onClick: handleClick,
  };

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<Record<string, unknown> & { className?: string }>;
    return React.cloneElement(child, { ...sharedProps, ref });
  }

  return (
    <button ref={ref} {...rest} {...sharedProps}>
      {children}
    </button>
  );
});

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
