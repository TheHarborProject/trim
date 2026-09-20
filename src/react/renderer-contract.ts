// Trim — the public renderer contract. Type-only: this file compiles to
// nothing at runtime, so it carries no "use client" — there is no runtime
// export here to gate (contrast react/index.ts's own comment: every *real*
// export in this package's public surface originates in a file that itself
// needs the directive; a type has no runtime existence to place on either
// side of that boundary).
//
// Not a new abstraction: this is exactly useTrimControlState's existing
// return shape (control, value, setValue — see ./hooks.ts), and exactly
// what DefaultBooleanControl/DefaultToggleActionControl already took as
// props before this file existed. Formalizing it as an exported type lets a
// custom renderer type its own props against it instead of duck-typing
// three fields by hand.

import type { TrimControl } from "../core/integration";

export type TrimControlRendererProps<V = unknown> = {
  control: TrimControl<V>;
  value: V | undefined;
  setValue: (value: V) => void;
};
