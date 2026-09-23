// Stands in for state a real host app already owns — this file is NOT part
// of Trim and exports nothing from the package. A plain module-level value
// plus a listener Set: the simplest thing with a genuine get/set/subscribe
// shape, deliberately not a new "state abstraction" invented for this
// example. A real project would point ../trim/controls/contrast.trim.ts's
// callback() at whatever it already has — a Zustand/Redux selector, a
// signal, a class field — this file just needs to exist to make that
// concrete.

type Listener = (value: boolean) => void;

let contrast = false;
const listeners = new Set<Listener>();

export function getContrast(): boolean {
  return contrast;
}

export function setContrast(value: boolean): void {
  contrast = value;
  for (const listener of listeners) listener(value);
}

export function subscribeContrast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
