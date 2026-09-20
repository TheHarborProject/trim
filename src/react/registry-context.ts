"use client";

// The single default registry instance and the context used to override it,
// shared by components.tsx (<Trim.Registry>/<Trim.Integration> write to it)
// and hooks.ts (the headless read hooks read from it) — so a <Trim.Panel/>
// mounted anywhere sees exactly what was registered anywhere else, with no
// explicit wiring required.

import { createContext } from "react";
import { createTrimRegistry, type TrimRegistry } from "../core/registry";

export const defaultTrimRegistry: TrimRegistry = createTrimRegistry();
export const TrimRegistryContext = createContext<TrimRegistry | null>(null);
